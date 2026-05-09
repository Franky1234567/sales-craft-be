import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ message: "Name, email, and password are required" });
      return;
    }

    const existing = await db`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      res.status(400).json({ message: "Email already registered" });
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const rows = await db`
      INSERT INTO users (name, email, password)
      VALUES (${name}, ${email}, ${hashed})
      RETURNING id, name, email, created_at
    `;
    const user = rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET!, { expiresIn: "7d" });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const rows = await db`SELECT id, name, email, password FROM users WHERE email = ${email}`;
    const user = rows[0];

    if (!user) {
      res.status(400).json({ message: "The provided credentials are incorrect." });
      return;
    }

    const match = await bcrypt.compare(password, user.password as string);
    if (!match) {
      res.status(400).json({ message: "The provided credentials are incorrect." });
      return;
    }

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET!, { expiresIn: "7d" });

    res.json({ user: { id: user.id, name: user.name, email: user.email }, token });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const logout = async (_req: Request, res: Response) => {
  res.json({ message: "Logged out successfully" });
};

export const me = async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db`SELECT id, name, email, created_at FROM users WHERE id = ${req.user!.id}`;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};