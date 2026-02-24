import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_SAMPLE_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_SAMPLE_API_KEY,
    api_secret: process.env.CLOUDINARY_SAMPLE_SECRET,
});

const uploadOnCloudinaryService = async (localFilePath) => {
    try {
        if (!localFilePath) return null;
        //upload the file on cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, { resource_type: "auto" })
        // console.log(response);
        //file has been uploaded successfully
        // console.log("file has been uploaded successfully", response.url);
        fs.unlinkSync(localFilePath);
        return response;
    } catch (error) {
        fs.unlinkSync(localFilePath)//remove the localy saved temporary file as the upload operation got failed
        return null;
    }
}

export { uploadOnCloudinaryService };