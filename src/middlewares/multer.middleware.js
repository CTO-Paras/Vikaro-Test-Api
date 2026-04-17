import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./public/temp")
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
 
export const uploadMiddleware = multer({ storage: storage });