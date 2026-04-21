# Category API Postman Testing (All Routes)

Base URL
- http://localhost:8000

Route Prefix
- /api/categories

Full Base
- http://localhost:8000/api/categories

## 1. Create Category

API
- POST http://localhost:8000/api/categories/

Headers
- Content-Type: application/json

Body (raw JSON)
```json
{
  "title": "Home Services"
}
```

## 2. Add Service Into Category

API
- POST http://localhost:8000/api/categories/:categoryId/service

Example
- POST http://localhost:8000/api/categories/67f1234567890abc12345678/service

Headers
- Content-Type: application/json

Body (raw JSON)
```json
{
  "name": "Electrical"
}
```

## 3. Add Subservice (Image Upload to Cloudinary)

API
- POST http://localhost:8000/api/categories/:categoryId/service/:serviceId/subservice

Example
- POST http://localhost:8000/api/categories/67f1234567890abc12345678/service/67f1234567890abc12345699/subservice

Body Type
- form-data

Fields
- name (Text): Fan Repair
- price (Text/Number): 299
- description (Text): Ceiling fan repair and fitting
- image (File): choose image file

Note
- `image` key is required.
- `quantity` is optional and defaults to 1 in schema.

## 4. Get All Categories

API
- GET http://localhost:8000/api/categories/

## 5. Get Single Category

API
- GET http://localhost:8000/api/categories/:id

Example
- GET http://localhost:8000/api/categories/67f1234567890abc12345678

## 6. Get Services By Category

API
- GET http://localhost:8000/api/categories/:categoryId/services

Example
- GET http://localhost:8000/api/categories/67f1234567890abc12345678/services

## 7. Get Single Subservice Details

API
- GET http://localhost:8000/api/categories/:categoryId/service/:serviceId/subservice/:subServiceId

Example
- GET http://localhost:8000/api/categories/67f1234567890abc12345678/service/67f1234567890abc12345699/subservice/67f1234567890abc12345700

Response Data Includes
- name
- price
- quantity
- image
- description

## Suggested Testing Order

1. Create Category
2. Add Service
3. Add Subservice (with image)
4. Get All Categories
5. Get Single Category
6. Get Services By Category
7. Get Single Subservice Details

## Common Errors

- 400: Image file is required (missing `image` in form-data)
- 404: Category not found
- 404: Service not found
- 404: Subservice not found
- 500: Cloudinary upload failed
