import multer from "multer";
import fs from "fs";
import path from "path";

const tempUploadDirectory = path.resolve(process.cwd(), "public", "temp");
const MULTER_DELETE_RETRIES = 2;

const ensureTempUploadDirectory = () => {
  fs.mkdirSync(tempUploadDirectory, { recursive: true });
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const collectUploadedFilePaths = (req) => {
  const filePaths = [];

  if (req?.file?.path) {
    filePaths.push(req.file.path);
  }

  if (req?.files && typeof req.files === "object") {
    for (const entry of Object.values(req.files)) {
      if (!Array.isArray(entry)) continue;
      for (const file of entry) {
        if (file?.path) {
          filePaths.push(file.path);
        }
      }
    }
  }

  return [...new Set(filePaths.map((filePath) => path.resolve(filePath)))];
};

const cleanupUploadedFiles = async (req) => {
  const filePaths = collectUploadedFilePaths(req);

  for (const filePath of filePaths) {
    for (let attempt = 0; attempt <= MULTER_DELETE_RETRIES; attempt += 1) {
      try {
        await fs.promises.unlink(filePath);
        break;
      } catch (error) {
        if (error?.code === "ENOENT") {
          break;
        }

        const retryable = error?.code === "EPERM" || error?.code === "EBUSY";
        if (!retryable || attempt === MULTER_DELETE_RETRIES) {
          break;
        }

        await delay(50 * (attempt + 1));
      }
    }
  }
};

const attachCleanupAfterResponse = (req, res) => {
  if (res.locals.__tempUploadCleanupAttached) return;
  res.locals.__tempUploadCleanupAttached = true;

  let cleanupStarted = false;

  const runCleanup = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    cleanupUploadedFiles(req).catch(() => {
      // Non-blocking cleanup.
    });
  };

  res.on("finish", runCleanup);
  res.on("close", runCleanup);
};

const wrapUploadMiddleware = (handler) => {
  return (req, res, next) => {
    handler(req, res, (error) => {
      attachCleanupAfterResponse(req, res);

      if (error) {
        cleanupUploadedFiles(req)
          .catch(() => {
            // Non-blocking cleanup.
          })
          .finally(() => next(error));
        return;
      }

      next();
    });
  };
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureTempUploadDirectory();
    cb(null, tempUploadDirectory)
  },
  filename:  function (req, file, cb) {
    const ext = path.extname(file.originalname || "");
    const baseName = path
      .basename(file.originalname || "file", ext)
      .replace(/[^a-zA-Z0-9-_]/g, "-");
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

    cb(null, `${baseName}-${uniqueSuffix}${ext}`)
  }
});

const uploader = multer({ storage: storage });

export const uploadMiddleware = {
  single: (fieldName) => wrapUploadMiddleware(uploader.single(fieldName)),
  array: (fieldName, maxCount) => wrapUploadMiddleware(uploader.array(fieldName, maxCount)),
  fields: (fields) => wrapUploadMiddleware(uploader.fields(fields)),
  any: () => wrapUploadMiddleware(uploader.any()),
  none: () => wrapUploadMiddleware(uploader.none()),
};