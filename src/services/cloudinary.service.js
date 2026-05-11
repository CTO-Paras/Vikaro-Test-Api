import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { getEnvPairValue } from '../utils/env.js';

const LOCAL_FILE_DELETE_RETRIES = 3;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const deleteLocalFileWithRetries = async (filePath) => {
    if (!filePath) return;

    for (let attempt = 0; attempt <= LOCAL_FILE_DELETE_RETRIES; attempt += 1) {
        try {
            await fs.promises.unlink(filePath);
            return;
        } catch (error) {
            if (error?.code === "ENOENT") {
                return;
            }

            const isRetryable = error?.code === "EBUSY" || error?.code === "EPERM";
            if (!isRetryable || attempt === LOCAL_FILE_DELETE_RETRIES) {
                return;
            }

            await delay(75 * (attempt + 1));
        }
    }
};

cloudinary.config({
    cloud_name: getEnvPairValue({
        localKey: "CLOUDINARY_LOCAL_CLOUD_NAME",
        productionKey: "CLOUDINARY_PRODUCTION_CLOUD_NAME",
        fallbackKey: "CLOUDINARY_SAMPLE_CLOUD_NAME",
    }),
    api_key: getEnvPairValue({
        localKey: "CLOUDINARY_LOCAL_API_KEY",
        productionKey: "CLOUDINARY_PRODUCTION_API_KEY",
        fallbackKey: "CLOUDINARY_SAMPLE_API_KEY",
    }),
    api_secret: getEnvPairValue({
        localKey: "CLOUDINARY_LOCAL_API_SECRET",
        productionKey: "CLOUDINARY_PRODUCTION_API_SECRET",
        fallbackKey: "CLOUDINARY_SAMPLE_SECRET",
    }),
});

const CLOUDINARY_ROOT_FOLDER = "vikaro";

export const CLOUDINARY_FOLDERS = {
    FREELANCER_PROFILE: `${CLOUDINARY_ROOT_FOLDER}/freelancer/profile`,
    ADMIN_PROFILE: `${CLOUDINARY_ROOT_FOLDER}/admin/profile`,
    SYSTEM_MISC: `${CLOUDINARY_ROOT_FOLDER}/system/misc`,
};

const toSlugSegment = (value, fallback = "misc") => {
    const slug = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug || fallback;
};

export const buildCategoryMediaFolders = ({
    categoryTitle,
    serviceName,
    subServiceName,
} = {}) => {
    const categorySlug = toSlugSegment(categoryTitle, "uncategorized");
    const serviceSlug = toSlugSegment(serviceName, "general");
    const subServiceSlug = toSlugSegment(subServiceName, "item");
    const categoryBase = `${CLOUDINARY_ROOT_FOLDER}/category/${categorySlug}`;
    const serviceBase = `${categoryBase}/services/${serviceSlug}`;

    return {
        serviceLogo: `${serviceBase}/logo`,
        serviceBanner: `${serviceBase}/banner`,
        subServiceImage: `${serviceBase}/subservices/${subServiceSlug}/image`,
    };
};

export const uploadOnCloudinaryService = async (
    localFilePath,
    folder = CLOUDINARY_FOLDERS.SYSTEM_MISC
) => {
    if (!localFilePath) return null;

    const resolvedLocalFilePath = path.isAbsolute(localFilePath)
        ? localFilePath
        : path.resolve(process.cwd(), localFilePath);

    try {
        const normalizedFolder = String(folder || CLOUDINARY_FOLDERS.SYSTEM_MISC).trim();

        const response = await cloudinary.uploader.upload(resolvedLocalFilePath, {
            resource_type: "auto",
            folder: normalizedFolder,
        });

        return response;
    } catch {
        return null;
    } finally {
        await deleteLocalFileWithRetries(resolvedLocalFilePath);
        if (localFilePath !== resolvedLocalFilePath) {
            await deleteLocalFileWithRetries(localFilePath);
        }
    }
};

const extractPublicIdFromUrl = (publicUrl) => {
    try {
        const parsedUrl = new URL(publicUrl);
        const uploadMarker = "/upload/";
        const uploadIndex = parsedUrl.pathname.indexOf(uploadMarker);

        if (uploadIndex === -1) return null;

        const afterUpload = parsedUrl.pathname.slice(uploadIndex + uploadMarker.length);
        const withoutVersion = afterUpload.replace(/^v\d+\//, "");
        const withoutExtension = withoutVersion.replace(/\.[^.\/]+$/, "");

        return withoutExtension || null;
    } catch {
        return null;
    }
};

export const deleteFromCloudinary = async (publicUrl) => {
    try {
        if (!publicUrl) return null;
        const publicId = extractPublicIdFromUrl(publicUrl);
        if (!publicId) return null;

        await cloudinary.uploader.destroy(publicId);
    } catch (error) {
        console.log("Cloudinary Delete Error:", error.message);
    }
};
