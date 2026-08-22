/**
 * =========================================================================
 * WISMA ATRIA FCC PORTAL - MODULAR PLACARDS CONFIGURATION
 * =========================================================================
 */

const PORTAL_PLACARDS = [
  {
    id: "directory",
    color: "brown",
    icon: "📖",
    title: "Directory",
    subtitle: "WA Directory",
    description: "Shops & contact info",
    link: "directory/index.html"
  },
  {
    id: "toc-camera",
    color: "emerald",
    icon: "📹",
    title: "TOC Camera",
    subtitle: "Opening & Closing",
    description: "Shops timing check",
    link: "toc-camera/index.html"
  },
  {
    id: "breakdowns",
    color: "yellow",
    icon: "⚠️",
    title: "Breakdowns",
    subtitle: "Equipment Faults",
    description: "Lifts & escalators",
    link: "breakdowns-reporting/index.html"
  },
  {
    id: "parking-violation",
    color: "purple",
    icon: "🚗",
    title: "Parking Violation",
    subtitle: "Illegal Parking",
    description: "Notice & alerts",
    link: "parking-violation/index.html"
  },
  {
    id: "l2-staircase",
    color: "blue",
    icon: "🪜",
    title: "L2 Staircase Photo",
    subtitle: "Crowd Checks",
    description: "3pm & 6pm timing",
    link: "l2-staircase/index.html"
  },
  {
    id: "carpark-calculator",
    color: "rose",
    icon: "📱",
    title: "Carpark Calculator",
    subtitle: "Rates & Payment",
    description: "Parking QR generator",
    link: "carpark-calculator/index.html"
  }
];

function renderPlacards() {
  const container = document.getElementById("hubView");
  if (!container) return;

  let html = "";
  PORTAL_PLACARDS.forEach(card => {
    html += `
      <div class="hero-card ${card.color}">
          <div class="card-top">
              <div class="icon-box">${card.icon}</div>
              <div class="card-title-group">
                  <h2>${card.title}</h2>
                  <span class="${card.color}-text">${card.subtitle}</span>
              </div>
          </div>
          <p class="card-description">${card.description}</p>
          <a href="${card.link}" target="_self" class="btn btn-${card.color}" onclick="recordNavigation(event)">
              Open &rarr;
          </a>
      </div>
    `;
  });

  container.innerHTML = html;
}

// FAIL-SAFE EXECUTION: Runs immediately and on all page events
renderPlacards();
document.addEventListener("DOMContentLoaded", renderPlacards);
window.addEventListener("load", renderPlacards);
window.addEventListener("pageshow", renderPlacards);
