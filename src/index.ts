import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./modules/auth/auth.routes";
import generationsRoutes from "./modules/generations/generations.routes";

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "SalesCraft AI API jalan! 🚀" });
});

app.use("/api", authRoutes);
app.use("/api/generations", generationsRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;