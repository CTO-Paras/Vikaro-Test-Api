import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
		},
		email: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			lowercase: true,
		},
		password: {
			type: String,
			required: true,
			minlength: 6,
			select: false,
		},
		specialCode: {
			type: String,
			required: true,
			select: false,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		role: {
			type: String,
			enum: ["admin", "super_admin"],
			default: "admin",
		},
		lastLoginAt: {
			type: Date,
			default: null,
		},
		profileImage: {
			type: String,
			default: null,
		},
	},
	{ timestamps: true }
);

export const Admin = mongoose.model("Admin", adminSchema);
