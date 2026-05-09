import { Response } from "express";
import axios from "axios";
import db from "../../config/db";
import { AuthRequest } from "../../middleware/auth";

// ─── AI ──────────────────────────────────────────────────────────────────────

function buildPrompt(data: Record<string, string>): string {
  const styleHint: Record<string, string> = {
    minimal: "clean, whitespace-heavy, simple language",
    bold: "high-impact, aggressive, bold power words, urgency-driven",
    modern: "modern, professional, benefit-focused, conversational",
  };

  let prompt = "You are an expert conversion copywriter. Generate sales page content for the product below.\n\n";
  prompt += "PRODUCT:\n";
  prompt += `- Name: ${data.product_name}\n`;
  prompt += `- Description: ${data.description}\n`;
  prompt += `- Features: ${data.features}\n`;
  prompt += `- Target Audience: ${data.target_audience}\n`;
  prompt += `- Price: ${data.price}\n`;
  if (data.usp) prompt += `- USP: ${data.usp}\n`;

  prompt += `\nCOPYWRITING STYLE: ${styleHint[data.style_template] ?? styleHint.modern}\n\n`;
  prompt += "Return ONLY a valid JSON object - no markdown, no ```json, no explanation. Start directly with {.\n\n";
  prompt += `Required JSON structure:
{
  "headline": "main hero headline (powerful, max 10 words)",
  "subheadline": "supporting headline (1-2 sentences)",
  "hook": "short social proof line",
  "overview": "2-3 paragraph product overview",
  "benefits": [{ "icon": "emoji", "title": "benefit title", "description": "1-2 sentences" }],
  "features": [{ "name": "feature name", "description": "short description" }],
  "testimonials": [{ "quote": "testimonial", "name": "Full Name", "role": "Job Title", "company": "Company" }],
  "pricing": { "price": "price string", "period": "billing period or null", "includes": ["item 1", "item 2"] },
  "cta_primary": "primary CTA text",
  "cta_secondary": "secondary CTA or null",
  "urgency": "urgency line or null"
}
Rules: 3-5 benefits, all features listed, exactly 3 testimonials, at least 4 pricing includes.`;

  return prompt;
}

function parseJson(raw: string): object {
  let clean = raw.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
  let data = JSON.parse(clean);
  return data;
}

async function callAI(prompt: string): Promise<string> {
  // Primary: Groq
  try {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      { model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], max_tokens: 2048, temperature: 0.7 },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 60000 }
    );
    return res.data.choices[0].message.content;
  } catch {
    // Fallback: Gemini
    for (const model of ["gemini-2.5-flash", "gemini-2.0-flash"]) {
      try {
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
          { contents: [{ parts: [{ text: prompt }] }] },
          { timeout: 60000 }
        );
        return res.data.candidates[0].content.parts[0].text;
      } catch {
        continue;
      }
    }
  }
  throw new Error("All AI services unavailable. Please try again.");
}

// ─── CONTROLLERS ─────────────────────────────────────────────────────────────

export const index = async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let rows;
    let countRows;

    if (search) {
      rows = await db`
        SELECT id, product_name, description, style_template, created_at
        FROM content_generations
        WHERE user_id = ${req.user!.id}
          AND (product_name ILIKE ${"%" + search + "%"} OR description ILIKE ${"%" + search + "%"})
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      countRows = await db`
        SELECT COUNT(*) as total FROM content_generations
        WHERE user_id = ${req.user!.id}
          AND (product_name ILIKE ${"%" + search + "%"} OR description ILIKE ${"%" + search + "%"})
      `;
    } else {
      rows = await db`
        SELECT id, product_name, description, style_template, created_at
        FROM content_generations
        WHERE user_id = ${req.user!.id}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      countRows = await db`
        SELECT COUNT(*) as total FROM content_generations WHERE user_id = ${req.user!.id}
      `;
    }

    const total = parseInt(countRows[0].total as string);

    res.json({
      data: rows,
      current_page: page,
      per_page: limit,
      total,
      last_page: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("INDEX ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const store = async (req: AuthRequest, res: Response) => {
  try {
    const { product_name, description, features, target_audience, price, usp, style_template } = req.body;

    if (!product_name || !description || !features || !target_audience || !price || !style_template) {
      res.status(400).json({ message: "All required fields must be filled" });
      return;
    }

    if (!["modern", "minimal", "bold"].includes(style_template)) {
      res.status(400).json({ message: "style_template must be modern, minimal, or bold" });
      return;
    }

    const prompt = buildPrompt(req.body);
    const rawResponse = await callAI(prompt);
    const generatedJson = parseJson(rawResponse);

    const rows = await db`
      INSERT INTO content_generations (user_id, product_name, description, features, target_audience, price, usp, generated_json, style_template)
      VALUES (${req.user!.id}, ${product_name}, ${description}, ${features}, ${target_audience ?? null}, ${price}, ${usp ?? null}, ${JSON.stringify(generatedJson)}, ${style_template})
      RETURNING *
    `;

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("STORE ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const show = async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db`SELECT * FROM content_generations WHERE id = ${req.params.id}`;
    const generation = rows[0];

    if (!generation) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    if (generation.user_id !== req.user!.id) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    res.json(generation);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const destroy = async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db`SELECT id, user_id FROM content_generations WHERE id = ${req.params.id}`;
    const generation = rows[0];

    if (!generation) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    if (generation.user_id !== req.user!.id) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    await db`DELETE FROM content_generations WHERE id = ${req.params.id}`;
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};