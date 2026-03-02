# Bricksoft Unit Scraper

Web scraper that logs into **rj.bricksoft.com**, scrapes unit data from every page, displays it in a sortable/searchable table, and lets you export to Excel.

## Data Collected

| Field | Description |
|-------|-------------|
| Unit Name | The unit identifier |
| H1 | H1 value |
| H2 | H2 value |
| Last Seen H1 | When H1 was last seen |
| Last Seen H2 | When H2 was last seen |

## Setup

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## Usage

1. Enter the site password (pre-filled with default)
2. Click **Start Scraping** - the scraper will log in, discover all pages, and extract unit data
3. Watch progress in the live status log
4. Use the search box to filter results
5. Click column headers to sort
6. Click **Export to Excel** to download the data as an `.xlsx` file

## Tech Stack

- **Backend:** Node.js, Express, Axios, Cheerio
- **Frontend:** Vanilla HTML/CSS/JS
- **Excel Export:** SheetJS (xlsx)
