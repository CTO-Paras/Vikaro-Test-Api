import { Cart } from "../models/cart.model.js";
import { Category } from "../models/category.model.js";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/APIResponce.js";
import { ApiError } from "../utils/APIError.js";
import { redisClientConfig } from "../config/redis.config.js";

const CART_CACHE_TTL_SECONDS = 2 * 60;

const buildCartCacheKey = (customerId) => `cache:cart:${customerId}`;

const toPlainObject = (value) => (value?.toObject ? value.toObject() : value);

const redisGetJson = async (key) => {
    if (!redisClientConfig.isOpen) return null;

    try {
        const rawValue = await redisClientConfig.get(key);
        return rawValue ? JSON.parse(rawValue) : null;
    } catch {
        return null;
    }
};

const redisSetJson = async (key, value, ttlSeconds) => {
    if (!redisClientConfig.isOpen) return;

    try {
        await redisClientConfig.set(key, JSON.stringify(value), {
            EX: ttlSeconds,
        });
    } catch {
        // Non-blocking cache write.
    }
};

const cacheCartByCustomerId = async (customerId, cart) => {
    const normalizedCustomerId = customerId?.toString?.() || String(customerId || "");
    if (!normalizedCustomerId) return;

    await redisSetJson(
        buildCartCacheKey(normalizedCustomerId),
        cart,
        CART_CACHE_TTL_SECONDS
    );
};

const assertObjectId = (value, fieldName) => {
    if (!mongoose.isValidObjectId(value)) {
        throw new ApiError(400, `${fieldName} is invalid`);
    }
};

const calculateCartTotal = (items = []) => {
    return items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
};

const buildCartResponse = (cart) => {
    const cartObject = toPlainObject(cart);
    const items = (cartObject?.items || []).map((item) => ({
        ...item,
        averageRating: Number(item.averageRating) || 0,
        totalBookingCount: Number(item.totalBookingCount) || 0,
    }));

    return {
        ...cartObject,
        items,
        uniqueItemCount: items.length,
        totalItemCount: items.reduce(
            (acc, item) => acc + (Number(item.quantity) || 0),
            0
        ),
    };
};

// ✅ 1. ADD TO CART
export const handlerAddToCart = asyncHandler(async (req, res) => {
    const { categoryId, serviceId, subServiceId } = req.body;
    const customerId = req.user._id;
    const customerIdString = customerId?.toString?.();

    if (!categoryId || !serviceId || !subServiceId) {
        throw new ApiError(400, "categoryId, serviceId and subServiceId are required");
    }

    assertObjectId(categoryId, "categoryId");
    assertObjectId(serviceId, "serviceId");
    assertObjectId(subServiceId, "subServiceId");

    const category = await Category.findById(categoryId);
    if (!category) throw new ApiError(404, "Category not found");

    const service = category.services.id(serviceId);
    if (!service) throw new ApiError(404, "Service not found");

    const subService = service?.subServices.id(subServiceId);
    if (!subService) throw new ApiError(404, "Sub-service not found");

    let cart = await Cart.findOne({ customerId });
    if (!cart) {
        cart = await Cart.create({ customerId, items: [] });
    }

    const existingIndex = cart.items.findIndex(item => 
        item.subServiceId.toString() === subServiceId
    );

    if (existingIndex > -1) {
        cart.items[existingIndex].quantity += 1;
        cart.items[existingIndex].averageRating = Number(subService.averageRating) || 0;
        cart.items[existingIndex].totalBookingCount = Number(subService.totalBookingCount) || 0;
    } else {
        cart.items.push({
            categoryId,
            serviceId,
            subServiceId,
            name: subService.name,
            price: subService.price,
            image: subService.image,
            averageRating: Number(subService.averageRating) || 0,
            totalBookingCount: Number(subService.totalBookingCount) || 0,
        });
    }

    cart.totalAmount = calculateCartTotal(cart.items);
    await cart.save();

    const cartObject = buildCartResponse(cart);
    if (customerIdString) {
        await cacheCartByCustomerId(customerIdString, cartObject);
    }

    res.status(200).json(new ApiResponse(200, cartObject, "Item added to cart"));
});

// ✅ 2. GET CART DETAILS (Simple Version)
export const handlerGetCart = asyncHandler(async (req, res) => {
    const customerId = req.user._id;
    const customerIdString = customerId?.toString?.();

    if (customerIdString) {
        const cachedCart = await redisGetJson(buildCartCacheKey(customerIdString));
        if (cachedCart) {
            return res.status(200).json(new ApiResponse(200, cachedCart, "Cart details fetched successfully"));
        }
    }

    const cart = await Cart.findOne({ customerId });
    
    if (!cart || cart.items.length === 0) {
        const emptyCart = {
            items: [],
            totalAmount: 0,
            uniqueItemCount: 0,
            totalItemCount: 0,
        };
        if (customerIdString) {
            await cacheCartByCustomerId(customerIdString, emptyCart);
        }
        return res.status(200).json(new ApiResponse(200, emptyCart, "Cart is empty"));
    }

    const cartObject = buildCartResponse(cart);
    if (customerIdString) {
        await cacheCartByCustomerId(customerIdString, cartObject);
    }

    res.status(200).json(new ApiResponse(200, cartObject, "Cart details fetched successfully"));
});

// ✅ 3. REMOVE ITEM FROM CART
export const handlerRemoveFromCart = asyncHandler(async (req, res) => {
    const { subServiceId } = req.params;
    const customerId = req.user._id;
    const customerIdString = customerId?.toString?.();

    if (!subServiceId) {
        throw new ApiError(400, "subServiceId is required");
    }
    assertObjectId(subServiceId, "subServiceId");

    const cart = await Cart.findOne({ customerId });
    if (!cart) throw new ApiError(404, "Cart not found");

    const previousCount = cart.items.length;

    cart.items = cart.items.filter((item) => {
        const itemId = item._id?.toString?.();
        const itemSubServiceId = item.subServiceId?.toString?.();

        return itemId !== subServiceId && itemSubServiceId !== subServiceId;
    });
    if (cart.items.length === previousCount) {
        const cartObject = buildCartResponse(cart);
        if (customerIdString) {
            await cacheCartByCustomerId(customerIdString, cartObject);
        }

        return res
            .status(200)
            .json(new ApiResponse(200, cartObject, "Item already removed from cart"));
    }

    cart.totalAmount = calculateCartTotal(cart.items);
    await cart.save();

    const cartObject = buildCartResponse(cart);
    if (customerIdString) {
        await cacheCartByCustomerId(customerIdString, cartObject);
    }

    res.status(200).json(new ApiResponse(200, cartObject, "Item removed from cart"));
});
