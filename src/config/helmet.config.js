import helmet from "helmet";

const helmetConfig = helmet({
  frameguard: {
    action: "deny",
  },

  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },

  referrerPolicy: {
    policy: "no-referrer",
  },

  // Disable CSP for APIs and sockets
  contentSecurityPolicy: false,

  // Prevent issues with socket.io and external APIs
  crossOriginEmbedderPolicy: false,

  crossOriginResourcePolicy: {
    policy: "cross-origin",
  },
});

export { helmetConfig };