import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_SAMPLE_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_SAMPLE_API_KEY,
    api_secret: process.env.CLOUDINARY_SAMPLE_SECRET,
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
    try {
        if (!localFilePath) return null;
        const normalizedFolder = String(folder || CLOUDINARY_FOLDERS.SYSTEM_MISC).trim();

        const response = await cloudinary.uploader.upload(localFilePath, { 
            resource_type: "auto",
            folder: normalizedFolder,
        });
        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        return response;
    } catch (error) {
        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        return null;
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