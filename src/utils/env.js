const isProductionEnv = () => process.env.NODE_ENV === "production";

const getEnvPairValue = ({
  localKey,
  productionKey,
  fallbackKey,
  defaultValue = undefined,
}) => {
  const localValue = process.env[localKey];
  const productionValue = process.env[productionKey];
  const fallbackValue = fallbackKey ? process.env[fallbackKey] : undefined;

  if (isProductionEnv()) {
    return productionValue || fallbackValue || localValue || defaultValue;
  }

  return localValue || fallbackValue || productionValue || defaultValue;
};

export { getEnvPairValue, isProductionEnv };
