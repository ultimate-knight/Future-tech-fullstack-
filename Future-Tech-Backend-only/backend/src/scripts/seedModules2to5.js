/**
 * One-time seed: populates ClassContent for Module 2–5 across every
 * level, using the official curriculum topic lists (one class per
 * topic) — the same approach used for Module 1. No PDFs are attached
 * yet; upload those from Admin → Class Content for each class once this
 * has run.
 *
 * Safe to run more than once — skips any level/module that already has
 * ClassContent rows, so it won't duplicate or clobber anything you've
 * since edited.
 *
 * Usage:  node src/scripts/seedModules2to5.js
 */
require("dotenv").config();
const { ClassContent } = require("../models");
const sequelize = require("../config/database");

const DATA = {
  level1: {
    module2: [
      "What is Artificial Intelligence?",
      "AI in Our Daily Life",
      "Human Intelligence vs AI",
      "How Computers Learn",
      "How AI Recognizes Patterns",
      "AI Can See – Computer Vision",
      "AI Can Hear – Speech Recognition",
      "AI & Smart Assistants",
      "Responsible & Ethical AI"
    ],
    module3: [
      "Introduction to Scratch",
      "Sprites & Characters",
      "Stage & Backgrounds",
      "Motion Blocks",
      "Events & Starting a Program",
      "Conditions & Decision Making",
      "Sensing & User Interaction",
      "Operators & Calculations",
      "Broadcasting & Messages"
    ],
    module4: [
      "Introduction to Cyber Safety",
      "What is the Internet?",
      "Strong passwords",
      "Personal information",
      "Phishing awareness",
      "Safe Internet Browsing",
      "Cyberbullying awareness",
      "Social Media Safety",
      "Fake News & Online Information",
      "Device & Account Security"
    ],
    module5: [
      "AI Smart Assistant",
      "AI Chatbot for Students",
      "AI Story Creator",
      "AI Voice Recognition",
      "AI Waste Sorting",
      "AI Cyber Safety Helper"
    ],
  },
  level2: {
    module2: [
      "Introduction to AI",
      "What is Generative AI?",
      "Introduction to ChatGPT",
      "Writing Effective Prompts",
      "ChatGPT for Creative Writing",
      "AI Presentation Tools",
      "AI for Coding & Programming",
      "AI for Language Learning",
      "AI Safety & Privacy",
      "Responsible & Ethical Use of AI"
    ],
    module3: [
      "What is Machine Learning",
      "AI vs ML",
      "How Machines Learn",
      "Data and Information",
      "Features and Labels",
      "Types of Data",
      "Collecting Data",
      "Understanding Datasets",
      "Data Cleaning",
      "Patterns in Data"
    ],
    module4: [
      "Introduction to Cybersecurity",
      "Why Cybersecurity is Important",
      "Personal Information & Privacy",
      "Strong Passwords",
      "Password Security",
      "Multi-Factor Authentication (MFA)",
      "Safe Internet Browsing",
      "Website Security & HTTPS",
      "Antivirus & Device Protection",
      "Wi-Fi & Network Safety"
    ],
    module5: [
      "AI Introduction Project",
      "AI Chatbot",
      "AI Quiz Generator",
      "AI Story Generator",
      "AI Image Creator",
      "AI Voice Assistant Concept",
      "AI Recommendation System",
      "AI Plant Classifier",
      "AI Health & Fitness Awareness",
      "AI Cybersecurity Awareness"
    ],
  },
  level3: {
    module2: [
      "Introduction to Machine Learning",
      "AI vs Machine Learning",
      "Machine Learning Workflow",
      "Features & Target Variables",
      "Data Collection & Preparation",
      "Exploratory Data Analysis (EDA)",
      "Training & Testing Data",
      "Supervised Learning",
      "Unsupervised Learning"
    ],
    module3: [
      "Introduction to Data Science",
      "Data Science vs AI vs ML",
      "Types of Data",
      "Data Sources & Data Collection",
      "Datasets & Data Tables",
      "Introduction to Python for Data Science",
      "NumPy Basics",
      "Data Selection & Filtering",
      "Pandas Basics"
    ],
    module4: [
      "Introduction to Ethical Hacking",
      "Cybersecurity vs Ethical Hacking",
      "Types of Hackers",
      "Cyber Ethics & Legal Awareness",
      "Information Security Basics",
      "Phishing & Social Engineering",
      "Malware & Common Threats",
      "Firewalls & Network Protection",
      "Vulnerability & Risk Assessment"
    ],
    module5: [
      "Student Attendance Management System",
      "School Library Management System",
      "Personal Expense Tracker",
      "Online Quiz Application",
      "Student Performance Prediction",
      "Smart Traffic Safety System",
      "Smart Water Usage Monitor",
      "Weather Information Dashboard",
      "School Energy Monitoring Dashboard"
    ],
  },
  level4: {
    module2: [
      "Advanced AI & Machine Learning Introduction",
      "End-to-End ML Workflow",
      "Data Preprocessing",
      "Feature Engineering",
      "K-Nearest Neighbors (KNN)",
      "Support Vector Machines (SVM)",
      "Model Evaluation & Validation",
      "Deep Learning Basics",
      "Natural Language Processing (NLP)",
      "AI Ethics, Bias, Privacy & Responsible AI"
    ],
    module3: [
      "Introduction to Generative AI",
      "Generative AI Tools & Platforms",
      "AI for Text Generation",
      "AI Image Generation",
      "Generative AI APIs",
      "AI for Coding & Programming",
      "Generative AI Capstone Project",
      "AI Audio & Speech Generation",
      "Large Language Models (LLMs)"
    ],
    module4: [
      "Advanced Cybersecurity Introduction",
      "Ethical Hacking & Cyber Laws",
      "CIA Triad & Security Principles",
      "Network Security",
      "Networking Fundamentals for Security",
      "Web Application Security",
      "Security Scanning & Reconnaissance Concepts",
      "Security Monitoring & Log Analysis",
      "Cloud, Mobile & IoT Security",
      "OWASP Top 10 Concepts"
    ],
    module5: [
      "AI-Powered Student Study Assistant",
      "Smart School Management System",
      "AI-Based Attendance Analysis System",
      "AI Book Recommendation System",
      "AI School Information Chatbot",
      "Weather Data Analysis & Prediction",
      "Cybersecurity Awareness Platform",
      "AI-Based Sentiment Analysis System"
    ],
  },
};

async function run() {
  for (const level of Object.keys(DATA)) {
    for (const moduleParam of Object.keys(DATA[level])) {
      const titles = DATA[level][moduleParam];

      const existingCount = await ClassContent.count({ where: { level, module: moduleParam } });
      if (existingCount > 0) {
        console.log(`${level}/${moduleParam}: already has ${existingCount} class(es) - skipping.`);
        continue;
      }

      console.log(`${level}/${moduleParam}: creating ${titles.length} class(es)...`);
      for (let i = 0; i < titles.length; i++) {
        await ClassContent.create({
          level,
          module: moduleParam,
          classNumber: i + 1,
          title: titles[i],
          // No pdfFilename yet - upload each class's PDF from Admin ->
          // Class Content once this script has run.
        });
      }
    }
  }
  console.log("Done.");
}

run()
  .catch((err) => {
    console.error("Seeding failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
