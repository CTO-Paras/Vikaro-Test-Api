import { Router } from "express";

const jobRouter = Router();


jobRouter.get("/test", (req, res) => {
    res.status(200).json({ message: "Job route is working!" });
});


export { jobRouter };