const express = require("express");
const path = require("path");
const XLSX = require("xlsx");
const { scrapeAll } = require("./scraper");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Store scraped data in memory for the session
let scrapedData = [];
let scrapeStatus = { running: false, messages: [], done: false, error: null };

// POST /api/scrape - Start scraping
app.post("/api/scrape", async (req, res) => {
  if (scrapeStatus.running) {
    return res.status(409).json({ error: "Scrape already in progress" });
  }

  const password = req.body.password || "GoRJourney!";

  scrapeStatus = { running: true, messages: [], done: false, error: null };
  scrapedData = [];

  // Run scrape in background so we can stream status
  scrapeAll(password, (msg) => {
    scrapeStatus.messages.push(msg);
  })
    .then((units) => {
      scrapedData = units;
      scrapeStatus.running = false;
      scrapeStatus.done = true;
    })
    .catch((err) => {
      scrapeStatus.running = false;
      scrapeStatus.done = true;
      scrapeStatus.error = err.message;
      console.error("Scrape error:", err);
    });

  res.json({ message: "Scrape started" });
});

// GET /api/status - Check scrape progress
app.get("/api/status", (req, res) => {
  res.json(scrapeStatus);
});

// GET /api/data - Get scraped data
app.get("/api/data", (req, res) => {
  res.json(scrapedData);
});

// GET /api/export - Export data to Excel and download
app.get("/api/export", (req, res) => {
  if (scrapedData.length === 0) {
    return res.status(404).json({ error: "No data to export. Run a scrape first." });
  }

  // Build worksheet data
  const wsData = [["Unit Name", "H1", "H2", "Last Seen H1", "Last Seen H2"]];
  for (const unit of scrapedData) {
    wsData.push([
      unit.unitName,
      unit.h1,
      unit.h2,
      unit.lastSeenH1,
      unit.lastSeenH2,
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-size columns
  ws["!cols"] = [
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 20 },
    { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Unit Data");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    'attachment; filename="bricksoft_unit_data.xlsx"'
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.send(buffer);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
