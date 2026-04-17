import morgan from "morgan";

const isDev = process.env.NODE_ENV === "development";

const morganConfig = morgan(isDev ? "dev" : "combined");

export { morganConfig };