import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pulsegrid.app',
  appName: 'Trading Journal',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'always' },
  android: { allowMixedContent: false }
};

export default config;
