const oneSignalConfig = {
  appId: process.env.ONESIGNAL_APP_ID,
  apiKey: process.env.ONESIGNAL_API_KEY,
  baseUrl: "https://onesignal.com/api/v1/notifications"
};
console.log("OneSignal Config Loaded:", {
  appId: process.env.ONESIGNAL_APP_ID,
  apiKey: process.env.ONESIGNAL_API_KEY,
});
export { oneSignalConfig };