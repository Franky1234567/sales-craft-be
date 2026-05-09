import { Router } from "express";
import { index, store, show, destroy } from "./generations.controller";
import { authMiddleware } from "../../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/", index);
router.post("/", store);
router.get("/:id", show);
router.delete("/:id", destroy);

export default router;