use base64::{engine::general_purpose::STANDARD, Engine};
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use argon2::Argon2;
use hmac::{Hmac, Mac};
use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{collections::HashMap, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
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

#[derive(Deserialize)]
struct Asset { coin: String, available: String, frozen: String, locked: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesPosition { symbol: String, hold_side: String, margin_size: String, total: String, unrealized_pl: String, mark_price: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UtaFuturesPosition { symbol: String, pos_side: String, position_balance: String, total: String, unrealised_pnl: String, mark_price: String }

#[derive(Deserialize)]
struct UtaPositionData { list: Vec<UtaFuturesPosition> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UtaAsset { coin: String, #[serde(default)] available: String, #[serde(default)] locked: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UtaAccountData { #[serde(default)] account_equity: String, #[serde(default)] usdt_equity: String, #[serde(default)] unrealised_pnl: String, #[serde(default)] usdt_unrealised_pnl: String, #[serde(default)] assets: Vec<UtaAsset> }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesTicker { symbol: String, open_utc: String, mark_price: String }

#[derive(Deserialize)]
struct FuturesBillData { bills: Vec<FuturesBill> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesBill { symbol: String, amount: String, fee: String, business_type: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FuturesAccount {
    margin_coin: String,
    #[serde(default)] available: String,
    #[serde(default)] locked: String,
    #[serde(default)] account_equity: String,
    #[serde(default)] unrealized_pl: String,
    #[serde(default)] max_transfer_out: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker { symbol: String, last_pr: String, open_utc: String, quote_volume: String, high24h: String, low24h: String }

#[derive(Clone, Serialize, Deserialize)]
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
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FuturesBalanceSummary {
    margin_coin: String,
    available: f64,
    locked: f64,
    account_equity: f64,
    unrealized_pnl: f64,
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

fn save_snapshot(app: &tauri::AppHandle, positions: &[PortfolioCoin]) -> Result<(), String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let mut history = read_history(app).unwrap_or_default();
    merge_snapshot(&mut history, positions, now);
    let json = serde_json::to_string(&history).map_err(|e| e.to_string())?;
    std::fs::write(history_path(app)?, json).map_err(|e| e.to_string())
}

fn merge_snapshot(history: &mut Vec<HistoryEntry>, positions: &[PortfolioCoin], now: u128) {
    let entry = HistoryEntry {
        timestamp: now,
        total_pnl: positions.iter().map(|p| p.daily_pnl).sum(),
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
        unrealized_pnl: parse_number(&account.unrealized_pl),
        max_transfer_out: parse_number(&account.max_transfer_out),
    })
}

fn timestamp_ms() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().to_string()
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

async fn get_futures(credentials: &BitgetCredentials) -> Result<Vec<FuturesPosition>, String> {
    let path = "/api/v2/mix/position/all-position";
    // marginCoin is optional; omitting it also returns isolated and multi-asset USDT positions.
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
        .send().await.map_err(|e| format!("Bitget futures connection failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("Bitget futures HTTP {status}")); }
    let payload: ApiResponse<Vec<FuturesPosition>> = serde_json::from_str(&body).map_err(|_| "Invalid Bitget futures response".to_string())?;
    if payload.code != "00000" { return Err(if payload.msg.is_empty() { format!("Bitget error {}", payload.code) } else { payload.msg }); }
    Ok(payload.data)
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
    if !status.is_success() { return Err(format!("Bitget UTA futures HTTP {status}")); }
    let payload: ApiResponse<UtaPositionData> = serde_json::from_str(&body).map_err(|_| "Invalid Bitget UTA futures response".to_string())?;
    if payload.code != "00000" { return Err(if payload.msg.is_empty() { format!("Bitget UTA error {}", payload.code) } else { payload.msg }); }
    Ok(payload.data.list.into_iter().map(|position| FuturesPosition {
        symbol: position.symbol, hold_side: position.pos_side, margin_size: position.position_balance,
        total: position.total, unrealized_pl: position.unrealised_pnl, mark_price: position.mark_price,
    }).collect())
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

fn utc_day_start_ms() -> u128 {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    now - (now % 86_400_000)
}

fn is_pnl_bill(business_type: &str) -> bool {
    !business_type.starts_with("trans_") && !matches!(business_type,
        "append_margin" | "adjust_down_lever_append_margin" | "reduce_margin" | "auto_append_margin" |
        "cash_gift_issue" | "cash_gift_recycle" | "bonus_issue" | "bonus_recycle" | "bonus_expired"
    )
}

fn futures_daily_pnl(side: &str, total: f64, mark: f64, open_utc: f64, realized_today: f64, lifetime_pnl: f64) -> f64 {
    let mark_to_market = if open_utc > 0.0 {
        if side == "SHORT" { total * (open_utc - mark) } else { total * (mark - open_utc) }
    } else { lifetime_pnl };
    mark_to_market + realized_today
}

async fn get_futures_bills(credentials: &BitgetCredentials) -> Result<Vec<FuturesBill>, String> {
    let path = "/api/v2/mix/account/bill";
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let query = format!("productType=USDT-FUTURES&startTime={}&endTime={now}&limit=100", utc_day_start_ms());
    let timestamp = timestamp_ms();
    let sign = signature(&credentials.api_secret, &timestamp, "GET", path, &query)?;
    let response = Client::new().get(format!("https://api.bitget.com{path}?{query}"))
        .header("ACCESS-KEY", &credentials.api_key)
        .header("ACCESS-SIGN", sign)
        .header("ACCESS-PASSPHRASE", &credentials.passphrase)
        .header("ACCESS-TIMESTAMP", timestamp)
        .header("Content-Type", "application/json")
        .header("locale", "en-US")
        .send().await.map_err(|e| format!("Bitget bills connection failed: {e}"))?;
    let body = response.text().await.map_err(|e| e.to_string())?;
    let payload: ApiResponse<FuturesBillData> = serde_json::from_str(&body).map_err(|_| "Invalid Bitget bills response".to_string())?;
    if payload.code != "00000" { return Err(if payload.msg.is_empty() { format!("Bitget error {}", payload.code) } else { payload.msg }); }
    Ok(payload.data.bills)
}

async fn portfolio(credentials: &BitgetCredentials) -> Result<PortfolioResponse, String> {
    let (tickers, futures_tickers) = tokio::try_join!(get_tickers(), get_futures_tickers())?;
    let (assets_result, futures_result, bills_result, accounts_result, uta_account_result) = tokio::join!(get_assets(credentials), get_all_futures(credentials), get_futures_bills(credentials), get_futures_accounts(credentials), get_uta_account(credentials));
    if assets_result.is_err() && futures_result.is_err() {
        return Err(format!("Spot: {}; Futures: {}", assets_result.err().unwrap_or_default(), futures_result.err().unwrap_or_default()));
    }
    let assets = assets_result.unwrap_or_default();
    let futures = futures_result.map_err(|error| format!("Bitget futures positions: {error}"))?;
    let bills = bills_result.unwrap_or_default();
    let futures_balance = accounts_result.ok().and_then(summarize_futures_balance).or_else(|| uta_account_result.ok().map(summarize_uta_balance));
    let ticker_map: HashMap<String, Ticker> = tickers.into_iter().map(|t| (t.symbol.clone(), t)).collect();
    let futures_ticker_map: HashMap<String, FuturesTicker> = futures_tickers.into_iter().map(|t| (canonical_futures_symbol(&t.symbol), t)).collect();
    let mut realized_by_symbol: HashMap<String, f64> = HashMap::new();
    for bill in bills.into_iter().filter(|b| is_pnl_bill(&b.business_type)) {
        if bill.symbol.is_empty() { continue; }
        *realized_by_symbol.entry(canonical_futures_symbol(&bill.symbol)).or_default() += parse_number(&bill.amount) + parse_number(&bill.fee);
    }
    let mut result = Vec::new();

    for asset in assets {
        let base = asset.coin.to_uppercase();
        let quantity = parse_number(&asset.available) + parse_number(&asset.frozen) + parse_number(&asset.locked);
        if quantity <= 0.0 { continue; }
        if base == "USDT" || base == "USDC" {
            result.push(PortfolioCoin { symbol: format!("{base}USDT"), base, exchange: "bitget".into(), price: 1.0, change24h: 0.0, quote_volume: 0.0, high24h: 1.0, low24h: 1.0, position_value: quantity, daily_pnl: 0.0 });
            continue;
        }
        let symbol = format!("{base}USDT");
        let Some(ticker) = ticker_map.get(&symbol) else { continue };
        let price = parse_number(&ticker.last_pr);
        let open = parse_number(&ticker.open_utc);
        let position_value = quantity * price;
        if price <= 0.0 || position_value < 0.01 { continue; }
        let daily_pnl = if open > 0.0 { quantity * (price - open) } else { 0.0 };
        let change24h = if open > 0.0 { (price / open - 1.0) * 100.0 } else { 0.0 };
        result.push(PortfolioCoin { symbol, base, exchange: "bitget".into(), price, change24h, quote_volume: parse_number(&ticker.quote_volume), high24h: parse_number(&ticker.high24h), low24h: parse_number(&ticker.low24h), position_value, daily_pnl });
    }

    for position in futures {
        let total = parse_number(&position.total);
        let mark_price = parse_number(&position.mark_price);
        if total <= 0.0 { continue; }
        let lifetime_pnl = parse_number(&position.unrealized_pl);
        let margin = parse_number(&position.margin_size);
        let side = position.hold_side.to_uppercase();
        let symbol = canonical_futures_symbol(&position.symbol);
        let base = symbol.trim_end_matches("USDT").to_uppercase();
        let open_utc = futures_ticker_map.get(&symbol).map(|t| parse_number(&t.open_utc)).unwrap_or(0.0);
        let ticker_mark = futures_ticker_map.get(&symbol).map(|t| parse_number(&t.mark_price)).unwrap_or(mark_price);
        let mark = if ticker_mark > 0.0 { ticker_mark } else { mark_price };
        if mark <= 0.0 { continue; }
        let realized_today = realized_by_symbol.remove(&symbol).unwrap_or(0.0);
        let pnl = futures_daily_pnl(&side, total, mark, open_utc, realized_today, lifetime_pnl);
        result.push(PortfolioCoin {
            symbol: format!("{}-{}", symbol, side),
            base: format!("{}·{}", base, if side == "SHORT" { "S" } else { "L" }),
            exchange: "bitget".into(),
            price: mark,
            change24h: if margin > 0.0 { pnl / margin * 100.0 } else { 0.0 },
            quote_volume: 0.0,
            high24h: mark,
            low24h: open_utc,
            position_value: total * mark,
            daily_pnl: pnl,
        });
    }
    for (symbol, pnl) in realized_by_symbol {
        if pnl.abs() < 0.000001 { continue; }
        let base = symbol.trim_end_matches("USDT").to_uppercase();
        let ticker = futures_ticker_map.get(&symbol);
        let mark = ticker.map(|t| parse_number(&t.mark_price)).unwrap_or(0.0);
        result.push(PortfolioCoin { symbol: format!("{symbol}-CLOSED"), base: format!("{base}·R"), exchange: "bitget".into(), price: mark, change24h: 0.0, quote_volume: 0.0, high24h: mark, low24h: mark, position_value: pnl.abs().max(1.0), daily_pnl: pnl });
    }
    result.sort_by(|a, b| b.position_value.total_cmp(&a.position_value));
    Ok(PortfolioResponse { positions: result, futures_balance })
}

#[tauri::command]
async fn connect_bitget(api_key: String, api_secret: String, passphrase: String, save_login: bool, login_password: Option<String>, state: tauri::State<'_, BitgetState>, app: tauri::AppHandle) -> Result<PortfolioResponse, String> {
    if api_key.trim().is_empty() || api_secret.trim().is_empty() || passphrase.trim().is_empty() { return Err("Enter all three Bitget API fields".into()); }
    let credentials = BitgetCredentials { api_key, api_secret, passphrase };
    let result = portfolio(&credentials).await?;
    if save_login { encrypt_credentials(&app, &credentials, login_password.as_deref().unwrap_or_default())?; }
    save_snapshot(&app, &result.positions)?;
    *state.0.lock().map_err(|_| "Credential state error".to_string())? = Some(credentials);
    Ok(result)
}

#[tauri::command]
async fn login_bitget(login_password: String, state: tauri::State<'_, BitgetState>, app: tauri::AppHandle) -> Result<PortfolioResponse, String> {
    let credentials = decrypt_credentials(&app, &login_password)?;
    let result = portfolio(&credentials).await?;
    save_snapshot(&app, &result.positions)?;
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
    save_snapshot(&app, &result.positions)?;
    Ok(result)
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
        .invoke_handler(tauri::generate_handler![connect_bitget, login_bitget, has_saved_login, delete_saved_login, refresh_bitget, disconnect_bitget, load_history, clear_history])
        .run(tauri::generate_context!())
        .expect("error while running Trading Journal");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coin(pnl: f64, value: f64) -> PortfolioCoin {
        PortfolioCoin { symbol: "BTCUSDT".into(), base: "BTC".into(), exchange: "bitget".into(), price: 100.0, change24h: 1.0, quote_volume: 10.0, high24h: 105.0, low24h: 95.0, position_value: value, daily_pnl: pnl }
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
        merge_snapshot(&mut history, &[coin(5.0, 100.0), coin(-2.0, 40.0)], 600_001);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].total_pnl, 3.0);
        assert_eq!(history[0].portfolio_value, 140.0);
        merge_snapshot(&mut history, &[coin(8.0, 120.0)], 600_999);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].total_pnl, 8.0);
        merge_snapshot(&mut history, &[coin(9.0, 130.0)], 900_001);
        assert_eq!(history.len(), 2);
    }

    #[test]
    fn futures_daily_profit_respects_long_short_and_realized() {
        assert_eq!(futures_daily_pnl("LONG", 2.0, 110.0, 100.0, 3.0, 0.0), 23.0);
        assert_eq!(futures_daily_pnl("SHORT", 2.0, 90.0, 100.0, -1.0, 0.0), 19.0);
        assert_eq!(futures_daily_pnl("LONG", 2.0, 110.0, 0.0, 3.0, 7.0), 10.0);
    }

    #[test]
    fn bill_filter_excludes_transfers_and_margin_movements() {
        assert!(is_pnl_bill("close_long"));
        assert!(is_pnl_bill("contract_settle_fee"));
        assert!(!is_pnl_bill("trans_from_exchange"));
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
            max_transfer_out: "90.00".into(),
        }]).unwrap();
        assert_eq!(summary.available, 105.25);
        assert_eq!(summary.locked, 20.5);
        assert_eq!(summary.account_equity, 130.75);
        assert_eq!(summary.unrealized_pnl, 5.0);
    }

    #[test]
    fn uta_position_response_deserializes_current_contract() {
        let payload: ApiResponse<UtaPositionData> = serde_json::from_str(r#"{"code":"00000","msg":"success","data":{"list":[{"symbol":"BTCUSDT","posSide":"short","positionBalance":"120","total":"0.01","unrealisedPnl":"4.5","markPrice":"90000"}]}}"#).unwrap();
        let position = &payload.data.list[0];
        assert_eq!(position.symbol, "BTCUSDT");
        assert_eq!(position.pos_side, "short");
        assert_eq!(position.position_balance, "120");
    }

    #[test]
    fn tradingview_perpetual_symbol_matches_bitget_rest_symbol() {
        assert_eq!(canonical_futures_symbol("XMRUSDTPERP"), "XMRUSDT");
        assert_eq!(canonical_futures_symbol("xmrusdt"), "XMRUSDT");
    }
}
