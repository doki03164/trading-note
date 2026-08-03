use base64::{engine::general_purpose::STANDARD, Engine};
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use argon2::Argon2;
use hmac::{Hmac, Mac};
use rand::RngCore;
use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::{collections::{HashMap, HashSet}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use zeroize::Zeroize;

#[derive(Clone)]
struct BitgetCredentials { api_key: String, api_secret: String, passphrase: String }

#[derive(Serialize, Deserialize)]
struct SavedCredentials { api_key: String, api_secret: String, passphrase: String }

#[derive(Serialize, Deserialize)]
struct CredentialVault { salt: String, nonce: String, ciphertext: String }

#[derive(Default)]
struct BitgetState(Mutex<Option<BitgetCredentials>>);

#[derive(Deserialize)]
struct ApiResponse<T> { code: String, #[serde(default)] msg: String, data: T }

fn string_or_default<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(match Option::<Value>::deserialize(deserializer)? {
        Some(Value::String(value)) => value,
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    })
}

#[derive(Deserialize)]
struct Asset { coin: String, available: String, frozen: String, locked: String }

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesPosition {
    #[serde(default, deserialize_with = "string_or_default")] symbol: String,
    #[serde(default, deserialize_with = "string_or_default")] hold_side: String,
    #[serde(default, deserialize_with = "string_or_default")] margin_size: String,
    #[serde(default, deserialize_with = "string_or_default")] total: String,
    #[serde(default, deserialize_with = "string_or_default")] unrealized_pl: String,
    #[serde(default, deserialize_with = "string_or_default")] mark_price: String,
    #[serde(default, deserialize_with = "string_or_default")] open_price_avg: String,
    #[serde(default, deserialize_with = "string_or_default")] leverage: String,
    #[serde(default, deserialize_with = "string_or_default")] liquidation_price: String,
    #[serde(default, deserialize_with = "string_or_default")] margin_mode: String,
    #[serde(default, deserialize_with = "string_or_default")] profit_rate: String,
    #[serde(default, deserialize_with = "string_or_default")] u_time: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ClassicPositionData { List(Vec<FuturesPosition>), Wrapped { #[serde(default)] list: Vec<FuturesPosition> } }

impl ClassicPositionData {
    fn into_positions(self) -> Vec<FuturesPosition> { match self { Self::List(value) => value, Self::Wrapped { list } => list } }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UtaFuturesPosition {
    symbol: String,
    pos_side: String,
    position_balance: String,
    total: String,
    unrealised_pnl: String,
    mark_price: String,
    #[serde(default)] avg_price: String,
    #[serde(default)] leverage: String,
    #[serde(default)] liquidation_price: String,
    #[serde(default)] margin_mode: String,
    #[serde(default)] profit_rate: String,
    #[serde(default)] updated_time: String,
}

#[derive(Deserialize)]
struct UtaPositionData { list: Vec<UtaFuturesPosition> }

fn normalize_uta_position(position: UtaFuturesPosition) -> FuturesPosition {
    FuturesPosition {
        symbol: position.symbol, hold_side: position.pos_side, margin_size: position.position_balance,
        total: position.total, unrealized_pl: position.unrealised_pnl, mark_price: position.mark_price,
        open_price_avg: position.avg_price, leverage: position.leverage,
        liquidation_price: position.liquidation_price, margin_mode: position.margin_mode,
        profit_rate: position.profit_rate, u_time: position.updated_time,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UtaAsset { coin: String, #[serde(default)] available: String, #[serde(default)] locked: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UtaAccountData { #[serde(default)] account_equity: String, #[serde(default)] usdt_equity: String, #[serde(default)] unrealised_pnl: String, #[serde(default)] usdt_unrealised_pnl: String, #[serde(default)] assets: Vec<UtaAsset> }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesTicker { symbol: String, mark_price: String }

#[derive(Deserialize)]
struct FuturesBillData { bills: Vec<FuturesBill>, #[serde(default)] end_id: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesBill { symbol: String, amount: String, fee: String, business_type: String }

#[derive(Deserialize)]
struct UtaFinancialData { #[serde(default)] list: Vec<UtaFinancialRecord>, #[serde(default)] cursor: String }

#[derive(Deserialize)]
struct UtaFinancialRecord {
    #[serde(default)] symbol: String,
    #[serde(default)] amount: String,
    #[serde(default)] fee: String,
    #[serde(rename = "type", default)] business_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesAccount {
    margin_coin: String,
    #[serde(default)] available: String,
    #[serde(default)] locked: String,
    #[serde(default)] account_equity: String,
    #[serde(default)] unrealized_pl: String,
    #[serde(default)] crossed_unrealized_pl: String,
    #[serde(default)] isolated_unrealized_pl: String,
    #[serde(default)] max_transfer_out: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker { symbol: String, last_pr: String, open_utc: String, quote_volume: String, high24h: String, low24h: String }

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PortfolioCoin {
    symbol: String,
    base: String,
    exchange: String,
    price: f64,
    change24h: f64,
    quote_volume: f64,
    high24h: f64,
    low24h: f64,
    position_value: f64,
    daily_pnl: f64,
    #[serde(default)] unrealized_pnl: Option<f64>,
    #[serde(default)] realized_pnl: Option<f64>,
    #[serde(default)] pnl_source: Option<String>,
    #[serde(default)] side: Option<String>,
    #[serde(default)] quantity: Option<f64>,
    #[serde(default)] margin: Option<f64>,
    #[serde(default)] entry_price: Option<f64>,
    #[serde(default)] mark_price: Option<f64>,
    #[serde(default)] leverage: Option<f64>,
    #[serde(default)] liquidation_price: Option<f64>,
    #[serde(default)] margin_mode: Option<String>,
    #[serde(default)] roi: Option<f64>,
    #[serde(default)] position_updated_at: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FuturesBalanceSummary {
    margin_coin: String,
    available: f64,
    locked: f64,
    account_equity: f64,
    unrealized_pnl: f64,
    realized_pnl: Option<f64>,
    max_transfer_out: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortfolioResponse {
    positions: Vec<PortfolioCoin>,
    futures_balance: Option<FuturesBalanceSummary>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    timestamp: u128,
    total_pnl: f64,
    #[serde(default)] unrealized_pnl: f64,
    #[serde(default)] realized_pnl: Option<f64>,
    portfolio_value: f64,
    positions: Vec<PortfolioCoin>,
}

fn history_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pnl-history.json"))
}

fn vault_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("bitget-vault.json"))
}

fn create_vault(credentials: &BitgetCredentials, password: &str) -> Result<CredentialVault, String> {
    if password.chars().count() < 8 { return Err("Login password must be at least 8 characters".into()); }
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut salt);
    rand::rng().fill_bytes(&mut nonce_bytes);
    let mut key = [0u8; 32];
    Argon2::default().hash_password_into(password.as_bytes(), &salt, &mut key).map_err(|_| "Password encryption failed".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Encryption setup failed".to_string())?;
    let plaintext = serde_json::to_vec(&SavedCredentials { api_key: credentials.api_key.clone(), api_secret: credentials.api_secret.clone(), passphrase: credentials.passphrase.clone() }).map_err(|e| e.to_string())?;
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref()).map_err(|_| "Credential encryption failed".to_string())?;
    key.zeroize();
    Ok(CredentialVault { salt: STANDARD.encode(salt), nonce: STANDARD.encode(nonce_bytes), ciphertext: STANDARD.encode(ciphertext) })
}

fn open_vault(vault: &CredentialVault, password: &str) -> Result<BitgetCredentials, String> {
    let salt = STANDARD.decode(vault.salt.as_bytes()).map_err(|_| "Saved login file is damaged".to_string())?;
    let nonce = STANDARD.decode(vault.nonce.as_bytes()).map_err(|_| "Saved login file is damaged".to_string())?;
    let ciphertext = STANDARD.decode(vault.ciphertext.as_bytes()).map_err(|_| "Saved login file is damaged".to_string())?;
    if nonce.len() != 12 { return Err("Saved login file is damaged".into()); }
    let mut key = [0u8; 32];
    Argon2::default().hash_password_into(password.as_bytes(), &salt, &mut key).map_err(|_| "Login failed".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Login failed".to_string())?;
    let plaintext = cipher.decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref()).map_err(|_| "Incorrect login password".to_string())?;
    key.zeroize();
    let saved: SavedCredentials = serde_json::from_slice(&plaintext).map_err(|_| "Saved login file is damaged".to_string())?;
    Ok(BitgetCredentials { api_key: saved.api_key, api_secret: saved.api_secret, passphrase: saved.passphrase })
}

fn encrypt_credentials(app: &tauri::AppHandle, credentials: &BitgetCredentials, password: &str) -> Result<(), String> {
    let vault = create_vault(credentials, password)?;
    std::fs::write(vault_path(app)?, serde_json::to_vec(&vault).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn decrypt_credentials(app: &tauri::AppHandle, password: &str) -> Result<BitgetCredentials, String> {
    let data = std::fs::read(vault_path(app)?).map_err(|_| "No saved Bitget login".to_string())?;
    let vault: CredentialVault = serde_json::from_slice(&data).map_err(|_| "Saved login file is damaged".to_string())?;
    open_vault(&vault, password)
}

fn read_history(app: &tauri::AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let path = history_path(app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| format!("History file error: {e}"))
}

fn save_snapshot(app: &tauri::AppHandle, positions: &[PortfolioCoin], balance: Option<&FuturesBalanceSummary>) -> Result<(), String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let mut history = read_history(app).unwrap_or_default();
    merge_snapshot(&mut history, positions, balance, now);
    let json = serde_json::to_string(&history).map_err(|e| e.to_string())?;
    std::fs::write(history_path(app)?, json).map_err(|e| e.to_string())
}

fn merge_snapshot(history: &mut Vec<HistoryEntry>, positions: &[PortfolioCoin], balance: Option<&FuturesBalanceSummary>, now: u128) {
    let unrealized_pnl = balance.map(|value| value.unrealized_pnl).unwrap_or_else(|| positions.iter().filter_map(|p| p.unrealized_pnl).sum());
    let realized_values: Vec<f64> = positions.iter().filter_map(|p| p.realized_pnl).collect();
    let realized_pnl = balance.and_then(|value| value.realized_pnl).or_else(|| if realized_values.is_empty() { None } else { Some(realized_values.iter().sum()) });
    let entry = HistoryEntry {
        timestamp: now,
        total_pnl: unrealized_pnl + realized_pnl.unwrap_or(0.0),
        unrealized_pnl,
        realized_pnl,
        portfolio_value: positions.iter().map(|p| p.position_value).sum(),
        positions: positions.to_vec(),
    };
    // Keep one snapshot per five-minute bucket so long-running sessions stay compact.
    if history.last().is_some_and(|last| last.timestamp / 300_000 == now / 300_000) { history.pop(); }
    history.push(entry);
    if history.len() > 10_000 { history.drain(0..history.len() - 10_000); }
}

fn parse_number(value: &str) -> f64 { value.parse::<f64>().unwrap_or(0.0) }

fn canonical_futures_symbol(value: &str) -> String {
    let upper = value.trim().to_uppercase();
    upper.strip_suffix("PERP").unwrap_or(&upper).to_string()
}

fn summarize_futures_balance(accounts: Vec<FuturesAccount>) -> Option<FuturesBalanceSummary> {
    accounts.into_iter().find(|account| account.margin_coin.eq_ignore_ascii_case("USDT")).map(|account| FuturesBalanceSummary {
        margin_coin: account.margin_coin,
        available: parse_number(&account.available),
        locked: parse_number(&account.locked),
        account_equity: parse_number(&account.account_equity),
        unrealized_pnl: if account.unrealized_pl.trim().is_empty() { parse_number(&account.crossed_unrealized_pl) + parse_number(&account.isolated_unrealized_pl) } else { parse_number(&account.unrealized_pl) },
        realized_pnl: None,
        max_transfer_out: parse_number(&account.max_transfer_out),
    })
}

fn timestamp_ms() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().to_string()
}

fn json_text(value: Option<&Value>) -> String {
    match value { Some(Value::String(value)) => value.clone(), Some(Value::Number(value)) => value.to_string(), Some(Value::Bool(value)) => value.to_string(), _ => String::new() }
}

fn parse_bitget_data<T: DeserializeOwned>(body: &str, context: &str) -> Result<T, String> {
    let envelope: Value = serde_json::from_str(body).map_err(|error| format!("{context}: response is not JSON ({error})"))?;
    let code = json_text(envelope.get("code"));
    let msg = json_text(envelope.get("msg"));
    let message = if msg.is_empty() { json_text(envelope.get("message")) } else { msg };
    if code != "00000" { return Err(if message.is_empty() { format!("{context} error {code}") } else { format!("{context} {code}: {message}") }); }
    let data = envelope.get("data").cloned().ok_or_else(|| format!("{context}: success response has no data"))?;
    serde_json::from_value(data).map_err(|error| format!("{context}: unsupported data format ({error})"))
}

fn bitget_http_error(context: &str, status: reqwest::StatusCode, body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let code = parsed.as_ref().map(|value| json_text(value.get("code"))).unwrap_or_default();
    let msg = parsed.as_ref().map(|value| json_text(value.get("msg"))).unwrap_or_default();
    let message = if msg.is_empty() { parsed.as_ref().map(|value| json_text(value.get("message"))).unwrap_or_default() } else { msg };
    if message.is_empty() { format!("{context} HTTP {status}") } else { format!("{context} HTTP {status} {code}: {message}") }
}

fn signature(secret: &str, timestamp: &str, method: &str, path: &str, query: &str) -> Result<String, String> {
    let suffix = if query.is_empty() { String::new() } else { format!("?{query}") };
    let payload = format!("{timestamp}{}{path}{suffix}", method.to_uppercase());
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).map_err(|_| "Invalid API secret".to_string())?;
    mac.update(payload.as_bytes());
    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}

async fn get_assets(credentials: &BitgetCredentials) -> Result<Vec<Asset>, String> {
    let path = "/api/v2/spot/account/assets";
    let query = "assetType=hold_only";
    let timestamp = timestamp_ms();
    let sign = signature(&credentials.api_secret, &timestamp, "GET", path, query)?;
    let response = Client::new().get(format!("https://api.bitget.com{path}?{query}"))
        .header("ACCESS-KEY", &credentials.api_key)
        .header("ACCESS-SIGN", sign)
        .header("ACCESS-PASSPHRASE", &credentials.passphrase)
        .header("ACCESS-TIMESTAMP", timestamp)
        .header("Content-Type", "application/json")
        .header("locale", "en-US")
        .send().await.map_err(|e| format!("Bitget connection failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("Bitget HTTP {status}")); }
    let payload: ApiResponse<Vec<Asset>> = serde_json::from_str(&body).map_err(|_| "Invalid Bitget response".to_string())?;
    if payload.code != "00000" { return Err(if payload.msg.is_empty() { format!("Bitget error {}", payload.code) } else { payload.msg }); }
    Ok(payload.data)
}

async fn get_tickers() -> Result<Vec<Ticker>, String> {
    let payload = Client::new().get("https://api.bitget.com/api/v2/spot/market/tickers")
        .send().await.map_err(|e| format!("Ticker connection failed: {e}"))?
        .json::<ApiResponse<Vec<Ticker>>>().await.map_err(|_| "Invalid ticker response".to_string())?;
    if payload.code != "00000" { return Err(payload.msg); }
    Ok(payload.data)
}

async fn get_futures_query(credentials: &BitgetCredentials, query: &str) -> Result<Vec<FuturesPosition>, String> {
    let path = "/api/v2/mix/position/all-position";
    let timestamp = timestamp_ms();
    let sign = signature(&credentials.api_secret, &timestamp, "GET", path, query)?;
    let response = Client::new().get(format!("https://api.bitget.com{path}?{query}"))
        .header("ACCESS-KEY", &credentials.api_key)
        .header("ACCESS-SIGN", sign)
        .header("ACCESS-PASSPHRASE", &credentials.passphrase)
        .header("ACCESS-TIMESTAMP", timestamp)
        .header("Content-Type", "application/json")
        .header("locale", "en-US")
        .send().await.map_err(|e| format!("Bitget futures connection failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(bitget_http_error("Bitget Classic futures", status, &body)); }
    Ok(parse_bitget_data::<ClassicPositionData>(&body, "Bitget Classic futures")?.into_positions())
}

async fn get_futures(credentials: &BitgetCredentials) -> Result<Vec<FuturesPosition>, String> {
    // This documented filter includes isolated USDT positions; the unfiltered call covers multi-asset variants.
    let filtered = get_futures_query(credentials, "productType=USDT-FUTURES&marginCoin=USDT").await;
    if filtered.as_ref().is_ok_and(|positions| !positions.is_empty()) { return filtered; }
    match get_futures_query(credentials, "productType=USDT-FUTURES").await {
        Ok(positions) => Ok(positions),
        Err(unfiltered_error) => match filtered {
            Ok(empty) => Ok(empty),
            Err(filtered_error) => Err(format!("USDT filter: {filtered_error}; all margins: {unfiltered_error}")),
        },
    }
}

async fn get_uta_futures(credentials: &BitgetCredentials) -> Result<Vec<FuturesPosition>, String> {
    let path = "/api/v3/position/current-position";
    let query = "category=USDT-FUTURES";
    let timestamp = timestamp_ms();
    let sign = signature(&credentials.api_secret, &timestamp, "GET", path, query)?;
    let response = Client::new().get(format!("https://api.bitget.com{path}?{query}"))
        .header("ACCESS-KEY", &credentials.api_key).header("ACCESS-SIGN", sign)
        .header("ACCESS-PASSPHRASE", &credentials.passphrase).header("ACCESS-TIMESTAMP", timestamp)
        .header("Content-Type", "application/json").header("locale", "en-US")
        .send().await.map_err(|e| format!("Bitget UTA futures connection failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(bitget_http_error("Bitget UTA futures", status, &body)); }
    let data = parse_bitget_data::<UtaPositionData>(&body, "Bitget UTA futures")?;
    Ok(data.list.into_iter().map(normalize_uta_position).collect())
}

async fn get_all_futures(credentials: &BitgetCredentials) -> Result<Vec<FuturesPosition>, String> {
    match get_futures(credentials).await {
        Ok(positions) if !positions.is_empty() => Ok(positions),
        classic => match get_uta_futures(credentials).await {
            Ok(positions) => Ok(positions),
            Err(uta_error) => match classic { Ok(empty) => Ok(empty), Err(classic_error) => Err(format!("Classic: {classic_error}; Unified: {uta_error}")) },
        },
    }
}

async fn get_uta_account(credentials: &BitgetCredentials) -> Result<UtaAccountData, String> {
    let path = "/api/v3/account/assets";
    let timestamp = timestamp_ms();
    let sign = signature(&credentials.api_secret, &timestamp, "GET", path, "")?;
    let response = Client::new().get(format!("https://api.bitget.com{path}"))
        .header("ACCESS-KEY", &credentials.api_key).header("ACCESS-SIGN", sign)
        .header("ACCESS-PASSPHRASE", &credentials.passphrase).header("ACCESS-TIMESTAMP", timestamp)
        .header("Content-Type", "application/json").header("locale", "en-US")
        .send().await.map_err(|e| format!("Bitget UTA account connection failed: {e}"))?;
    let body = response.text().await.map_err(|e| e.to_string())?;
    let payload: ApiResponse<UtaAccountData> = serde_json::from_str(&body).map_err(|_| "Invalid Bitget UTA account response".to_string())?;
    if payload.code != "00000" { return Err(if payload.msg.is_empty() { format!("Bitget UTA error {}", payload.code) } else { payload.msg }); }
    Ok(payload.data)
}

fn summarize_uta_balance(account: UtaAccountData) -> FuturesBalanceSummary {
    let usdt = account.assets.iter().find(|asset| asset.coin.eq_ignore_ascii_case("USDT"));
    FuturesBalanceSummary {
        margin_coin: "USDT".into(),
        available: usdt.map(|asset| parse_number(&asset.available)).unwrap_or(0.0),
        locked: usdt.map(|asset| parse_number(&asset.locked)).unwrap_or(0.0),
        account_equity: parse_number(if account.usdt_equity.is_empty() { &account.account_equity } else { &account.usdt_equity }),
        unrealized_pnl: parse_number(if account.usdt_unrealised_pnl.is_empty() { &account.unrealised_pnl } else { &account.usdt_unrealised_pnl }),
        realized_pnl: None,
        max_transfer_out: usdt.map(|asset| parse_number(&asset.available)).unwrap_or(0.0),
    }
}

async fn get_futures_accounts(credentials: &BitgetCredentials) -> Result<Vec<FuturesAccount>, String> {
    let path = "/api/v2/mix/account/accounts";
    let query = "productType=USDT-FUTURES";
    let timestamp = timestamp_ms();
    let sign = signature(&credentials.api_secret, &timestamp, "GET", path, query)?;
    let response = Client::new().get(format!("https://api.bitget.com{path}?{query}"))
        .header("ACCESS-KEY", &credentials.api_key)
        .header("ACCESS-SIGN", sign)
        .header("ACCESS-PASSPHRASE", &credentials.passphrase)
        .header("ACCESS-TIMESTAMP", timestamp)
        .header("Content-Type", "application/json")
        .header("locale", "en-US")
        .send().await.map_err(|e| format!("Bitget futures balance connection failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("Bitget futures balance HTTP {status}")); }
    let payload: ApiResponse<Vec<FuturesAccount>> = serde_json::from_str(&body).map_err(|_| "Invalid Bitget futures balance response".to_string())?;
    if payload.code != "00000" { return Err(if payload.msg.is_empty() { format!("Bitget error {}", payload.code) } else { payload.msg }); }
    Ok(payload.data)
}

async fn get_futures_tickers() -> Result<Vec<FuturesTicker>, String> {
    let payload = Client::new().get("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES")
        .send().await.map_err(|e| format!("Futures ticker connection failed: {e}"))?
        .json::<ApiResponse<Vec<FuturesTicker>>>().await.map_err(|_| "Invalid futures ticker response".to_string())?;
    if payload.code != "00000" { return Err(payload.msg); }
    Ok(payload.data)
}

fn is_pnl_bill(business_type: &str) -> bool {
    let value = business_type.to_lowercase();
    !value.starts_with("trans_") && !value.starts_with("transfer_") && !value.starts_with("user_exchange_") && !matches!(value.as_str(),
        "append_margin" | "adjust_down_lever_append_margin" | "reduce_margin" | "auto_append_margin" |
        "cash_gift_issue" | "cash_gift_recycle" | "bonus_issue" | "bonus_recycle" | "bonus_expired" |
        "risk_captital_user_transfer" | "risk_capital_user_transfer"
    )
}

fn futures_net_pnl(unrealized_pnl: f64, realized_pnl: Option<f64>) -> f64 { unrealized_pnl + realized_pnl.unwrap_or(0.0) }

fn futures_position_coin(position: &FuturesPosition, realized_pnl: Option<f64>, fallback_mark: f64) -> Option<PortfolioCoin> {
    let quantity = parse_number(&position.total);
    let position_mark = parse_number(&position.mark_price);
    let mark = if position_mark > 0.0 { position_mark } else { fallback_mark };
    if quantity <= 0.0 || mark <= 0.0 { return None; }
    let unrealized_pnl = parse_number(&position.unrealized_pl);
    let margin = parse_number(&position.margin_size);
    let side = if position.hold_side.eq_ignore_ascii_case("short") { "SHORT" } else { "LONG" };
    let symbol = canonical_futures_symbol(&position.symbol);
    let base = symbol.trim_end_matches("USDT").to_uppercase();
    let roi = if position.profit_rate.trim().is_empty() {
        if margin > 0.0 { unrealized_pnl / margin * 100.0 } else { 0.0 }
    } else {
        parse_number(&position.profit_rate) * 100.0
    };
    let liquidation_price = parse_number(&position.liquidation_price);
    let updated_at = parse_number(&position.u_time);
    Some(PortfolioCoin {
        symbol: format!("{symbol}-{side}"),
        base: format!("{}·{}", base, if side == "SHORT" { "S" } else { "L" }),
        exchange: "bitget".into(),
        price: mark,
        change24h: roi,
        quote_volume: 0.0,
        high24h: mark,
        low24h: parse_number(&position.open_price_avg),
        position_value: quantity * mark,
        daily_pnl: futures_net_pnl(unrealized_pnl, realized_pnl),
        unrealized_pnl: Some(unrealized_pnl),
        realized_pnl,
        pnl_source: Some("exchange".into()),
        side: Some(side.into()),
        quantity: Some(quantity),
        margin: Some(margin),
        entry_price: Some(parse_number(&position.open_price_avg)),
        mark_price: Some(mark),
        leverage: Some(parse_number(&position.leverage)),
        liquidation_price: (liquidation_price > 0.0).then_some(liquidation_price),
        margin_mode: (!position.margin_mode.is_empty()).then(|| position.margin_mode.to_uppercase()),
        roi: Some(roi),
        position_updated_at: (updated_at > 0.0).then_some(updated_at as u64),
    })
}

async fn get_signed_data<T: DeserializeOwned>(credentials: &BitgetCredentials, path: &str, query: &str, context: &str) -> Result<T, String> {
    let timestamp = timestamp_ms();
    let sign = signature(&credentials.api_secret, &timestamp, "GET", path, query)?;
    let url = if query.is_empty() { format!("https://api.bitget.com{path}") } else { format!("https://api.bitget.com{path}?{query}") };
    let response = Client::new().get(url)
        .header("ACCESS-KEY", &credentials.api_key)
        .header("ACCESS-SIGN", sign)
        .header("ACCESS-PASSPHRASE", &credentials.passphrase)
        .header("ACCESS-TIMESTAMP", timestamp)
        .header("Content-Type", "application/json")
        .header("locale", "en-US")
        .send().await.map_err(|e| format!("{context} connection failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(bitget_http_error(context, status, &body)); }
    parse_bitget_data::<T>(&body, context)
}

async fn get_classic_futures_bills(credentials: &BitgetCredentials, start: u128, end: u128) -> Result<Vec<FuturesBill>, String> {
    let path = "/api/v2/mix/account/bill";
    let mut bills = Vec::new();
    let mut cursor = String::new();
    let mut seen = HashSet::new();
    for _ in 0..100 {
        let cursor_query = if cursor.is_empty() { String::new() } else { format!("&idLessThan={cursor}") };
        let query = format!("productType=USDT-FUTURES&startTime={start}&endTime={end}&limit=100{cursor_query}");
        let page: FuturesBillData = get_signed_data(credentials, path, &query, "Bitget Classic bills").await?;
        let page_len = page.bills.len();
        bills.extend(page.bills);
        if page_len < 100 || page.end_id.is_empty() { return Ok(bills); }
        if !seen.insert(page.end_id.clone()) { return Err("Bitget Classic bills returned a repeated pagination cursor".into()); }
        cursor = page.end_id;
    }
    Err("Bitget Classic bills exceeded 10,000 UTC-day records".into())
}

async fn get_uta_futures_bills(credentials: &BitgetCredentials, start: u128, end: u128) -> Result<Vec<FuturesBill>, String> {
    let path = "/api/v3/account/financial-records";
    let mut bills = Vec::new();
    let mut cursor = String::new();
    let mut seen = HashSet::new();
    for _ in 0..100 {
        let cursor_query = if cursor.is_empty() { String::new() } else { format!("&cursor={cursor}") };
        let query = format!("category=USDT-FUTURES&startTime={start}&endTime={end}&limit=100{cursor_query}");
        let page: UtaFinancialData = get_signed_data(credentials, path, &query, "Bitget UTA financial records").await?;
        let page_len = page.list.len();
        bills.extend(page.list.into_iter().map(|record| FuturesBill { symbol: record.symbol, amount: record.amount, fee: record.fee, business_type: record.business_type }));
        if page_len < 100 || page.cursor.is_empty() { return Ok(bills); }
        if !seen.insert(page.cursor.clone()) { return Err("Bitget UTA records returned a repeated pagination cursor".into()); }
        cursor = page.cursor;
    }
    Err("Bitget UTA records exceeded 10,000 UTC-day records".into())
}

async fn get_futures_bills(credentials: &BitgetCredentials) -> Result<Vec<FuturesBill>, String> {
    let end = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let start = end - (end % 86_400_000);
    match get_classic_futures_bills(credentials, start, end).await {
        Ok(bills) => Ok(bills),
        Err(classic_error) => get_uta_futures_bills(credentials, start, end).await
            .map_err(|uta_error| format!("Classic bills: {classic_error}; UTA records: {uta_error}")),
    }
}

async fn portfolio(credentials: &BitgetCredentials) -> Result<PortfolioResponse, String> {
    let (tickers, futures_tickers) = tokio::try_join!(get_tickers(), get_futures_tickers())?;
    let (assets_result, futures_result, bills_result, accounts_result, uta_account_result) = tokio::join!(get_assets(credentials), get_all_futures(credentials), get_futures_bills(credentials), get_futures_accounts(credentials), get_uta_account(credentials));
    if assets_result.is_err() && futures_result.is_err() {
        return Err(format!("Spot: {}; Futures: {}", assets_result.err().unwrap_or_default(), futures_result.err().unwrap_or_default()));
    }
    let assets = assets_result.unwrap_or_default();
    let futures = futures_result.map_err(|error| format!("Bitget futures positions: {error}"))?;
    let bills_available = bills_result.is_ok();
    let bills = bills_result.unwrap_or_default();
    let mut futures_balance = accounts_result.ok().and_then(summarize_futures_balance).or_else(|| uta_account_result.ok().map(summarize_uta_balance));
    let ticker_map: HashMap<String, Ticker> = tickers.into_iter().map(|t| (t.symbol.clone(), t)).collect();
    let futures_ticker_map: HashMap<String, FuturesTicker> = futures_tickers.into_iter().map(|t| (canonical_futures_symbol(&t.symbol), t)).collect();
    let pnl_bills: Vec<FuturesBill> = bills.into_iter().filter(|b| is_pnl_bill(&b.business_type)).collect();
    let realized_total: f64 = pnl_bills.iter().map(|bill| parse_number(&bill.amount) + parse_number(&bill.fee)).sum();
    let mut realized_by_symbol: HashMap<String, f64> = HashMap::new();
    for bill in pnl_bills {
        if bill.symbol.is_empty() { continue; }
        *realized_by_symbol.entry(canonical_futures_symbol(&bill.symbol)).or_default() += parse_number(&bill.amount) + parse_number(&bill.fee);
    }
    let mut result = Vec::new();
    let mut exchange_unrealized_total = 0.0;
    let mut open_futures_count = 0usize;

    for asset in assets {
        let base = asset.coin.to_uppercase();
        let quantity = parse_number(&asset.available) + parse_number(&asset.frozen) + parse_number(&asset.locked);
        if quantity <= 0.0 { continue; }
        if base == "USDT" || base == "USDC" {
            result.push(PortfolioCoin { symbol: format!("{base}USDT"), base, exchange: "bitget".into(), price: 1.0, change24h: 0.0, quote_volume: 0.0, high24h: 1.0, low24h: 1.0, position_value: quantity, daily_pnl: 0.0, unrealized_pnl: None, realized_pnl: None, pnl_source: Some("not-applicable".into()), quantity: Some(quantity), ..PortfolioCoin::default() });
            continue;
        }
        let symbol = format!("{base}USDT");
        let Some(ticker) = ticker_map.get(&symbol) else { continue };
        let price = parse_number(&ticker.last_pr);
        let open = parse_number(&ticker.open_utc);
        let position_value = quantity * price;
        if price <= 0.0 || position_value < 0.01 { continue; }
        let change24h = if open > 0.0 { (price / open - 1.0) * 100.0 } else { 0.0 };
        result.push(PortfolioCoin { symbol, base, exchange: "bitget".into(), price, change24h, quote_volume: parse_number(&ticker.quote_volume), high24h: parse_number(&ticker.high24h), low24h: parse_number(&ticker.low24h), position_value, daily_pnl: 0.0, unrealized_pnl: None, realized_pnl: None, pnl_source: Some("not-applicable".into()), quantity: Some(quantity), ..PortfolioCoin::default() });
    }

    for position in futures {
        let lifetime_pnl = parse_number(&position.unrealized_pl);
        let symbol = canonical_futures_symbol(&position.symbol);
        let realized_today = realized_by_symbol.get(&symbol).copied().unwrap_or(0.0);
        let realized_pnl = bills_available.then_some(realized_today);
        let fallback_mark = futures_ticker_map.get(&symbol).map(|t| parse_number(&t.mark_price)).unwrap_or(0.0);
        let Some(coin) = futures_position_coin(&position, realized_pnl, fallback_mark) else { continue };
        realized_by_symbol.remove(&symbol);
        exchange_unrealized_total += lifetime_pnl;
        open_futures_count += 1;
        result.push(coin);
    }
    for (symbol, pnl) in realized_by_symbol {
        if pnl.abs() < 0.000001 { continue; }
        let base = symbol.trim_end_matches("USDT").to_uppercase();
        let ticker = futures_ticker_map.get(&symbol);
        let mark = ticker.map(|t| parse_number(&t.mark_price)).unwrap_or(0.0);
        result.push(PortfolioCoin { symbol: format!("{symbol}-CLOSED"), base: format!("{base}·R"), exchange: "bitget".into(), price: mark, change24h: 0.0, quote_volume: 0.0, high24h: mark, low24h: mark, position_value: pnl.abs().max(1.0), daily_pnl: pnl, unrealized_pnl: Some(0.0), realized_pnl: Some(pnl), pnl_source: Some("exchange".into()), ..PortfolioCoin::default() });
    }
    if let Some(balance) = futures_balance.as_mut() {
        if open_futures_count > 0 { balance.unrealized_pnl = exchange_unrealized_total; }
        balance.realized_pnl = bills_available.then_some(realized_total);
    }
    result.sort_by(|a, b| b.position_value.total_cmp(&a.position_value));
    Ok(PortfolioResponse { positions: result, futures_balance })
}

async fn live_contracts(credentials: &BitgetCredentials) -> Result<Vec<PortfolioCoin>, String> {
    let futures = get_all_futures(credentials).await
        .map_err(|error| format!("Bitget live futures positions: {error}"))?;
    let mut contracts: Vec<PortfolioCoin> = futures.iter()
        .filter_map(|position| futures_position_coin(position, None, 0.0))
        .collect();
    contracts.sort_by(|a, b| b.position_value.total_cmp(&a.position_value));
    Ok(contracts)
}

#[tauri::command]
async fn connect_bitget(api_key: String, api_secret: String, passphrase: String, save_login: bool, login_password: Option<String>, state: tauri::State<'_, BitgetState>, app: tauri::AppHandle) -> Result<PortfolioResponse, String> {
    if api_key.trim().is_empty() || api_secret.trim().is_empty() || passphrase.trim().is_empty() { return Err("Enter all three Bitget API fields".into()); }
    let credentials = BitgetCredentials { api_key, api_secret, passphrase };
    let result = portfolio(&credentials).await?;
    if save_login { encrypt_credentials(&app, &credentials, login_password.as_deref().unwrap_or_default())?; }
    save_snapshot(&app, &result.positions, result.futures_balance.as_ref())?;
    *state.0.lock().map_err(|_| "Credential state error".to_string())? = Some(credentials);
    Ok(result)
}

#[tauri::command]
async fn login_bitget(login_password: String, state: tauri::State<'_, BitgetState>, app: tauri::AppHandle) -> Result<PortfolioResponse, String> {
    let credentials = decrypt_credentials(&app, &login_password)?;
    let result = portfolio(&credentials).await?;
    save_snapshot(&app, &result.positions, result.futures_balance.as_ref())?;
    *state.0.lock().map_err(|_| "Credential state error".to_string())? = Some(credentials);
    Ok(result)
}

#[tauri::command]
fn has_saved_login(app: tauri::AppHandle) -> Result<bool, String> { Ok(vault_path(&app)?.exists()) }

#[tauri::command]
fn delete_saved_login(app: tauri::AppHandle) -> Result<(), String> {
    let path = vault_path(&app)?;
    if path.exists() { std::fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
async fn refresh_bitget(state: tauri::State<'_, BitgetState>, app: tauri::AppHandle) -> Result<PortfolioResponse, String> {
    let credentials = state.0.lock().map_err(|_| "Credential state error".to_string())?.clone().ok_or("Bitget is not connected")?;
    let result = portfolio(&credentials).await?;
    save_snapshot(&app, &result.positions, result.futures_balance.as_ref())?;
    Ok(result)
}

#[tauri::command]
async fn refresh_bitget_contracts(state: tauri::State<'_, BitgetState>) -> Result<Vec<PortfolioCoin>, String> {
    let credentials = state.0.lock().map_err(|_| "Credential state error".to_string())?.clone().ok_or("Bitget is not connected")?;
    live_contracts(&credentials).await
}

#[tauri::command]
fn disconnect_bitget(state: tauri::State<'_, BitgetState>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Credential state error".to_string())? = None;
    Ok(())
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Result<Vec<HistoryEntry>, String> { read_history(&app) }

#[tauri::command]
fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    std::fs::write(history_path(&app)?, "[]").map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BitgetState::default())
        .invoke_handler(tauri::generate_handler![connect_bitget, login_bitget, has_saved_login, delete_saved_login, refresh_bitget, refresh_bitget_contracts, disconnect_bitget, load_history, clear_history])
        .run(tauri::generate_context!())
        .expect("error while running Trading Journal");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coin(pnl: f64, value: f64) -> PortfolioCoin {
        PortfolioCoin { symbol: "BTCUSDT".into(), base: "BTC".into(), exchange: "bitget".into(), price: 100.0, change24h: 1.0, quote_volume: 10.0, high24h: 105.0, low24h: 95.0, position_value: value, daily_pnl: pnl, unrealized_pnl: Some(pnl), realized_pnl: Some(0.0), pnl_source: Some("exchange".into()), ..PortfolioCoin::default() }
    }

    #[test]
    fn bitget_signature_matches_known_vector() {
        let value = signature("test-secret", "1700000000000", "GET", "/api/v2/spot/account/assets", "assetType=hold_only").unwrap();
        assert_eq!(value, "mJG6fKy6fHL00x/I4Qp4TE+HDNDz4fYR8kovdxsxwJg=");
    }

    #[test]
    fn credential_vault_round_trip_and_wrong_password() {
        let credentials = BitgetCredentials { api_key: "key".into(), api_secret: "secret".into(), passphrase: "phrase".into() };
        let vault = create_vault(&credentials, "strong-password").unwrap();
        let opened = open_vault(&vault, "strong-password").unwrap();
        assert_eq!(opened.api_key, "key");
        assert_eq!(opened.api_secret, "secret");
        assert_eq!(opened.passphrase, "phrase");
        assert!(open_vault(&vault, "wrong-password").is_err());
        assert!(create_vault(&credentials, "short").is_err());
    }

    #[test]
    fn history_coalesces_five_minute_bucket_and_sums_values() {
        let mut history = Vec::new();
        merge_snapshot(&mut history, &[coin(5.0, 100.0), coin(-2.0, 40.0)], None, 600_001);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].total_pnl, 3.0);
        assert_eq!(history[0].unrealized_pnl, 3.0);
        assert_eq!(history[0].realized_pnl, Some(0.0));
        assert_eq!(history[0].portfolio_value, 140.0);
        merge_snapshot(&mut history, &[coin(8.0, 120.0)], None, 600_999);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].total_pnl, 8.0);
        merge_snapshot(&mut history, &[coin(9.0, 130.0)], None, 900_001);
        assert_eq!(history.len(), 2);
    }

    #[test]
    fn history_uses_exchange_account_totals_when_available() {
        let mut history = Vec::new();
        let balance = FuturesBalanceSummary { margin_coin: "USDT".into(), available: 100.0, locked: 0.0, account_equity: 114.0, unrealized_pnl: 10.0, realized_pnl: Some(4.0), max_transfer_out: 100.0 };
        merge_snapshot(&mut history, &[coin(3.0, 100.0)], Some(&balance), 600_001);
        assert_eq!(history[0].unrealized_pnl, 10.0);
        assert_eq!(history[0].realized_pnl, Some(4.0));
        assert_eq!(history[0].total_pnl, 14.0);
    }

    #[test]
    fn futures_net_profit_uses_exchange_unrealized_not_utc_open_price() {
        assert_eq!(futures_net_pnl(-7.25, Some(0.0)), -7.25);
        assert_eq!(futures_net_pnl(-7.25, Some(1.5)), -5.75);
        assert_eq!(futures_net_pnl(-7.25, None), -7.25);
    }

    #[test]
    fn bill_filter_excludes_transfers_and_margin_movements() {
        assert!(is_pnl_bill("close_long"));
        assert!(is_pnl_bill("contract_settle_fee"));
        assert!(!is_pnl_bill("trans_from_exchange"));
        assert!(!is_pnl_bill("TRANSFER_IN"));
        assert!(!is_pnl_bill("USER_EXCHANGE_BUY"));
        assert!(!is_pnl_bill("append_margin"));
        assert!(!is_pnl_bill("bonus_issue"));
    }

    #[test]
    fn futures_usdt_balance_summary_uses_account_equity_and_available() {
        let summary = summarize_futures_balance(vec![FuturesAccount {
            margin_coin: "USDT".into(),
            available: "105.25".into(),
            locked: "20.50".into(),
            account_equity: "130.75".into(),
            unrealized_pl: "5.00".into(),
            crossed_unrealized_pl: "4.00".into(),
            isolated_unrealized_pl: "3.00".into(),
            max_transfer_out: "90.00".into(),
        }]).unwrap();
        assert_eq!(summary.available, 105.25);
        assert_eq!(summary.locked, 20.5);
        assert_eq!(summary.account_equity, 130.75);
        assert_eq!(summary.unrealized_pnl, 5.0);
        assert_eq!(summary.realized_pnl, None);
    }

    #[test]
    fn futures_balance_falls_back_to_crossed_plus_isolated_unrealized() {
        let summary = summarize_futures_balance(vec![FuturesAccount {
            margin_coin: "USDT".into(), available: "100".into(), locked: "0".into(), account_equity: "90".into(),
            unrealized_pl: "".into(), crossed_unrealized_pl: "-3.25".into(), isolated_unrealized_pl: "-2.75".into(), max_transfer_out: "80".into(),
        }]).unwrap();
        assert_eq!(summary.unrealized_pnl, -6.0);
    }

    #[test]
    fn uta_position_response_deserializes_current_contract() {
        let payload: ApiResponse<UtaPositionData> = serde_json::from_str(r#"{"code":"00000","msg":"success","data":{"list":[{"symbol":"BTCUSDT","posSide":"short","positionBalance":"120","total":"0.01","unrealisedPnl":"4.5","markPrice":"90000","avgPrice":"89500","leverage":"6","liquidationPrice":"101000","marginMode":"isolated","profitRate":"0.0375","updatedTime":"1760000000000"}]}}"#).unwrap();
        let position = normalize_uta_position(payload.data.list.into_iter().next().unwrap());
        assert_eq!(position.symbol, "BTCUSDT");
        assert_eq!(position.hold_side, "short");
        assert_eq!(position.margin_size, "120");
        assert_eq!(position.open_price_avg, "89500");
        assert_eq!(position.leverage, "6");
        assert_eq!(position.profit_rate, "0.0375");
        assert_eq!(position.u_time, "1760000000000");
    }

    #[test]
    fn classic_position_parser_accepts_documented_and_wrapped_data() {
        let documented = r#"{"code":"00000","msg":"success","data":[{"symbol":"BTCUSDT","holdSide":"long","marginSize":"80","total":"0.01","unrealizedPL":"-7.25","markPrice":"64000"},{"symbol":"SOLUSDT","holdSide":"short","marginSize":"50","total":"1.5","unrealizedPL":"2.25","markPrice":"75"}]}"#;
        let positions = parse_bitget_data::<ClassicPositionData>(documented, "Classic").unwrap().into_positions();
        assert_eq!(positions.len(), 2);
        assert_eq!(positions[0].symbol, "BTCUSDT");
        assert_eq!(positions[0].total, "0.01");
        assert_eq!(positions[1].symbol, "SOLUSDT");

        let wrapped = r#"{"code":"00000","msg":"success","data":{"list":[{"symbol":"ETHUSDT","holdSide":"short","marginSize":60,"total":0.2,"unrealizedPL":null}]}}"#;
        let positions = parse_bitget_data::<ClassicPositionData>(wrapped, "Classic").unwrap().into_positions();
        assert_eq!(positions[0].symbol, "ETHUSDT");
        assert_eq!(positions[0].margin_size, "60");
        assert_eq!(positions[0].total, "0.2");
        assert!(positions[0].unrealized_pl.is_empty());
        assert!(positions[0].mark_price.is_empty());
    }

    #[test]
    fn live_contract_maps_exchange_position_metrics() {
        let position = FuturesPosition {
            symbol: "ETHUSDT".into(), hold_side: "short".into(), margin_size: "50".into(), total: "0.2".into(),
            unrealized_pl: "3.5".into(), mark_price: "1995".into(), open_price_avg: "2012.5".into(),
            leverage: "5".into(), liquidation_price: "2300".into(), margin_mode: "isolated".into(),
            profit_rate: "0.07".into(), u_time: "1760000000000".into(),
        };
        let contract = futures_position_coin(&position, Some(1.0), 0.0).unwrap();
        assert_eq!(contract.symbol, "ETHUSDT-SHORT");
        assert_eq!(contract.side.as_deref(), Some("SHORT"));
        assert_eq!(contract.quantity, Some(0.2));
        assert_eq!(contract.entry_price, Some(2012.5));
        assert_eq!(contract.mark_price, Some(1995.0));
        assert_eq!(contract.unrealized_pnl, Some(3.5));
        assert_eq!(contract.daily_pnl, 4.5);
        assert_eq!(contract.roi, Some(7.0));
        assert_eq!(contract.position_updated_at, Some(1_760_000_000_000));
    }

    #[test]
    fn bitget_error_with_null_data_surfaces_code_and_message() {
        let error = parse_bitget_data::<ClassicPositionData>(r#"{"code":"40014","msg":"Parameter verification failed","data":null}"#, "Classic").unwrap_err();
        assert_eq!(error, "Classic 40014: Parameter verification failed");
    }

    #[test]
    fn symbol_normalization_handles_multiple_contracts_case_and_whitespace() {
        let cases = [("BTCUSDTPERP", "BTCUSDT"), ("ethusdtperp", "ETHUSDT"), ("  SOLUSDT  ", "SOLUSDT"), ("1000PEPEUSDTPERP", "1000PEPEUSDT"), ("PERPUSDT", "PERPUSDT")];
        for (input, expected) in cases { assert_eq!(canonical_futures_symbol(input), expected); }
    }
}
