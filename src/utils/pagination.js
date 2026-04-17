const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const resolvePagination = (query = {}, options = {}) => {
  const {
    defaultPage = 1,
    defaultLimit = 10,
    maxLimit = 100,
  } = options;

  const page = toPositiveInt(query.page, defaultPage);
  const requestedLimit = toPositiveInt(query.limit, defaultLimit);
  const limit = Math.min(requestedLimit, maxLimit);
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
  };
};

const buildPaginationMeta = ({ total = 0, page = 1, limit = 10 }) => {
  const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / limit);

  return {
    total: safeTotal,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

export { resolvePagination, buildPaginationMeta };
