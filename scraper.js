const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://rj.bricksoft.com";

/**
 * Creates an authenticated axios session by logging into the site.
 * Tries multiple common login form structures to handle the site.
 */
async function createSession(password) {
  const session = axios.create({
    baseURL: BASE_URL,
    maxRedirects: 5,
    withCredentials: true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  let cookies = [];

  // Intercept responses to collect cookies
  session.interceptors.response.use((response) => {
    const setCookies = response.headers["set-cookie"];
    if (setCookies) {
      for (const raw of setCookies) {
        const nameValue = raw.split(";")[0];
        const name = nameValue.split("=")[0].trim();
        // Update or add cookie
        const idx = cookies.findIndex((c) => c.startsWith(name + "="));
        if (idx >= 0) cookies[idx] = nameValue;
        else cookies.push(nameValue);
      }
    }
    return response;
  });

  // Intercept requests to attach cookies
  session.interceptors.request.use((config) => {
    if (cookies.length > 0) {
      config.headers.Cookie = cookies.join("; ");
    }
    return config;
  });

  // Step 1: GET the login page to find the form and any CSRF tokens
  console.log("Fetching login page...");
  const loginPage = await session.get("/");
  const $ = cheerio.load(loginPage.data);

  // Find all forms on the page
  const forms = $("form");
  console.log(`Found ${forms.length} form(s) on login page`);

  // Look for password input fields
  const passwordInputs = $(
    'input[type="password"], input[name="password"], input[name="Password"], input[name="pwd"], input[name="pass"]'
  );
  console.log(`Found ${passwordInputs.length} password input(s)`);

  // Build form data from the first form that has a password field
  let formAction = "/";
  let formMethod = "POST";
  const formData = {};

  forms.each((i, form) => {
    const $form = $(form);
    const pwdField = $form.find(
      'input[type="password"], input[name="password"], input[name="Password"], input[name="pwd"], input[name="pass"]'
    );
    if (pwdField.length > 0) {
      formAction = $form.attr("action") || "/";
      formMethod = ($form.attr("method") || "POST").toUpperCase();

      // Collect all form inputs
      $form.find("input").each((j, input) => {
        const $input = $(input);
        const name = $input.attr("name");
        if (!name) return;
        const type = ($input.attr("type") || "text").toLowerCase();
        if (type === "password") {
          formData[name] = password;
        } else if (type === "submit") {
          formData[name] = $input.attr("value") || "Login";
        } else {
          formData[name] = $input.attr("value") || "";
        }
      });

      // Also collect select and textarea
      $form.find("select").each((j, sel) => {
        const name = $(sel).attr("name");
        if (name) {
          formData[name] = $(sel).find("option[selected]").attr("value") || $(sel).find("option:first-child").attr("value") || "";
        }
      });

      return false; // break
    }
  });

  // If no form with password found, try common patterns
  if (Object.keys(formData).length === 0) {
    console.log("No standard form found, trying common login patterns...");
    // Try posting password directly
    formData.password = password;
    formData.Password = password;
  }

  console.log(`Posting login to: ${formAction}`);
  console.log(`Form fields: ${Object.keys(formData).join(", ")}`);

  // Step 2: Submit the login form
  const loginResponse = await session.post(formAction, new URLSearchParams(formData).toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: BASE_URL + "/",
    },
    maxRedirects: 10,
    validateStatus: (status) => status < 400,
  });

  console.log(`Login response status: ${loginResponse.status}`);
  console.log(`Login redirected to: ${loginResponse.request?.path || "N/A"}`);

  return session;
}

/**
 * Discovers all navigable pages/links from the main dashboard after login.
 * Looks for unit listing pages, pagination, and navigation links.
 */
async function discoverPages(session) {
  console.log("\nDiscovering pages...");
  const response = await session.get("/");
  const $ = cheerio.load(response.data);

  const pages = new Set();
  pages.add("/");

  // Collect all internal links
  $("a[href]").each((i, el) => {
    const href = $(el).attr("href");
    if (
      href &&
      !href.startsWith("javascript:") &&
      !href.startsWith("mailto:") &&
      !href.startsWith("#")
    ) {
      if (href.startsWith("/") || href.startsWith(BASE_URL)) {
        const path = href.startsWith(BASE_URL)
          ? href.replace(BASE_URL, "")
          : href;
        pages.add(path);
      }
    }
  });

  console.log(`Discovered ${pages.size} unique page(s)`);
  return Array.from(pages);
}

/**
 * Finds all pagination links on a given page and returns them.
 */
function findPaginationLinks($) {
  const links = new Set();

  // Common pagination patterns
  const selectors = [
    ".pagination a[href]",
    ".pager a[href]",
    'a[href*="page="]',
    'a[href*="Page="]',
    'a[href*="pageNumber"]',
    'a[href*="pg="]',
    ".page-link[href]",
    'nav a[href]',
    'a[href*="offset"]',
  ];

  for (const selector of selectors) {
    $(selector).each((i, el) => {
      const href = $(el).attr("href");
      if (href && !href.startsWith("javascript:")) {
        const path = href.startsWith(BASE_URL)
          ? href.replace(BASE_URL, "")
          : href;
        links.add(path);
      }
    });
  }

  return Array.from(links);
}

/**
 * Extracts unit data from a page's HTML content.
 * Looks for tables containing unit information with columns for
 * unit name, h1, h2, last seen h1, last seen h2.
 */
function extractUnitsFromPage($) {
  const units = [];

  // Strategy 1: Look for data in HTML tables
  $("table").each((tableIdx, table) => {
    const $table = $(table);
    const headers = [];

    // Get header labels
    $table.find("thead th, thead td, tr:first-child th, tr:first-child td").each((i, th) => {
      headers.push($(th).text().trim().toLowerCase());
    });

    // If first row looks like headers, use it
    if (headers.length === 0) {
      const firstRow = $table.find("tr").first();
      firstRow.find("td, th").each((i, cell) => {
        headers.push($(cell).text().trim().toLowerCase());
      });
    }

    // Map header indices to our fields
    const fieldMap = {};
    headers.forEach((h, idx) => {
      const normalized = h.replace(/\s+/g, " ").toLowerCase();
      if (
        normalized.includes("unit") &&
        (normalized.includes("name") || normalized.includes("number") || normalized.includes("#"))
      ) {
        fieldMap.unitName = idx;
      } else if (normalized === "unit" || normalized === "name") {
        if (!fieldMap.unitName) fieldMap.unitName = idx;
      }
      if (/\bh1\b/.test(normalized) && normalized.includes("last")) {
        fieldMap.lastSeenH1 = idx;
      } else if (/\bh1\b/.test(normalized) && !fieldMap.h1) {
        fieldMap.h1 = idx;
      }
      if (/\bh2\b/.test(normalized) && normalized.includes("last")) {
        fieldMap.lastSeenH2 = idx;
      } else if (/\bh2\b/.test(normalized) && !fieldMap.h2) {
        fieldMap.h2 = idx;
      }
    });

    // If we couldn't map by header names, try positional mapping
    // based on typical Bricksoft layouts
    const hasMapping = Object.keys(fieldMap).length > 0;

    // Extract rows (skip header row)
    const rows = $table.find("tr").slice(1);
    rows.each((rowIdx, row) => {
      const cells = [];
      $(row)
        .find("td")
        .each((i, td) => {
          cells.push($(td).text().trim());
        });

      if (cells.length < 2) return; // skip empty/tiny rows

      if (hasMapping) {
        const unit = {
          unitName: cells[fieldMap.unitName] || "",
          h1: cells[fieldMap.h1] || "",
          h2: cells[fieldMap.h2] || "",
          lastSeenH1: cells[fieldMap.lastSeenH1] || "",
          lastSeenH2: cells[fieldMap.lastSeenH2] || "",
        };
        if (unit.unitName) units.push(unit);
      } else {
        // Fallback: try to map positionally for tables with 5+ columns
        if (cells.length >= 5) {
          units.push({
            unitName: cells[0],
            h1: cells[1],
            h2: cells[2],
            lastSeenH1: cells[3],
            lastSeenH2: cells[4],
          });
        }
      }
    });
  });

  // Strategy 2: Look for repeated card/div structures if no tables found
  if (units.length === 0) {
    const unitCards = $(
      '.unit, .unit-card, .unit-row, [class*="unit"], .card, .list-group-item'
    );
    unitCards.each((i, card) => {
      const $card = $(card);
      const text = $card.text();

      // Try to extract fields by label patterns
      const unitName =
        extractField($card, $, ["unit name", "unit #", "unit number", "unit"]) ||
        $card.find("h3, h4, h5, .unit-name, .title").first().text().trim();

      if (unitName) {
        units.push({
          unitName,
          h1: extractField($card, $, ["h1"]) || "",
          h2: extractField($card, $, ["h2"]) || "",
          lastSeenH1: extractField($card, $, ["last seen h1", "last h1", "h1 last"]) || "",
          lastSeenH2: extractField($card, $, ["last seen h2", "last h2", "h2 last"]) || "",
        });
      }
    });
  }

  return units;
}

/**
 * Helper: extract a field value from a card element by looking for labels.
 */
function extractField($card, $, labels) {
  for (const label of labels) {
    // Look for "Label: Value" patterns
    const regex = new RegExp(label + "[:\\s]+([^\\n<]+)", "i");
    const text = $card.html();
    if (text) {
      const match = text.replace(/<[^>]+>/g, " ").match(regex);
      if (match) return match[1].trim();
    }
  }
  return null;
}

/**
 * Main scraping function: logs in, discovers pages, scrapes all data.
 */
async function scrapeAll(password, onProgress) {
  const report = (msg) => {
    console.log(msg);
    if (onProgress) onProgress(msg);
  };

  report("Starting scraper...");
  const session = await createSession(password);

  report("Login complete. Discovering pages...");
  const initialPages = await discoverPages(session);

  const allUnits = [];
  const visitedUrls = new Set();
  const urlQueue = [...initialPages];

  let pageCount = 0;

  while (urlQueue.length > 0) {
    const url = urlQueue.shift();
    if (visitedUrls.has(url)) continue;
    visitedUrls.add(url);

    try {
      pageCount++;
      report(`Scraping page ${pageCount}: ${url}`);

      const response = await session.get(url, {
        validateStatus: (status) => status < 400,
      });
      const $ = cheerio.load(response.data);

      // Extract unit data from this page
      const pageUnits = extractUnitsFromPage($);
      if (pageUnits.length > 0) {
        report(`  Found ${pageUnits.length} units on ${url}`);
        allUnits.push(...pageUnits);
      }

      // Check for pagination links we haven't visited
      const paginationLinks = findPaginationLinks($);
      for (const link of paginationLinks) {
        if (!visitedUrls.has(link) && !urlQueue.includes(link)) {
          urlQueue.push(link);
        }
      }

      // Also discover deeper links on unit-related pages
      $("a[href]").each((i, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const path = href.startsWith(BASE_URL) ? href.replace(BASE_URL, "") : href;
        if (
          path.startsWith("/") &&
          !visitedUrls.has(path) &&
          !urlQueue.includes(path) &&
          !path.includes("logout") &&
          !path.includes("signout") &&
          !path.includes("delete") &&
          !path.match(/\.(jpg|png|gif|css|js|pdf|ico)$/i)
        ) {
          urlQueue.push(path);
        }
      });
    } catch (err) {
      report(`  Error on ${url}: ${err.message}`);
    }
  }

  // Deduplicate units by unitName
  const seen = new Set();
  const dedupedUnits = [];
  for (const unit of allUnits) {
    const key = unit.unitName;
    if (key && !seen.has(key)) {
      seen.add(key);
      dedupedUnits.push(unit);
    }
  }

  report(`\nScraping complete. ${dedupedUnits.length} unique units found across ${pageCount} pages.`);
  return dedupedUnits;
}

module.exports = { scrapeAll, createSession, discoverPages, extractUnitsFromPage };
