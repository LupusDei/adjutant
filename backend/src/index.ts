import cors from "cors";
import express from "express";

const app = express();
const PORT = process.env["PORT"] ?? 3001;

// Middleware
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
