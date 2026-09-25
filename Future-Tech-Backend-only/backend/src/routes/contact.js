const express = require("express");
const { body, validationResult } = require("express-validator");
const { ContactMessage } = require("../models");

const router = express.Router();

// POST /api/contact
router.post(
  "/",
  [
    body("name").trim().notEmpty().withMessage("Name is required."),
    body("email").isEmail().withMessage("A valid email is required."),
    body("message").trim().notEmpty().withMessage("Message is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const record = await ContactMessage.create({
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone || "",
        subject: req.body.subject || "",
        message: req.body.message,
      });
      res.status(201).json({ id: record.id, message: "Message received." });
    } catch (err) {
      console.error("contact submit error", err);
      res.status(500).json({ error: "Could not send your message. Please try again." });
    }
  }
);

module.exports = router;
