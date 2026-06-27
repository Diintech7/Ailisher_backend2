(function() {
  const PARAM_KEYS = ['clientId', 'examId', 'paperId'];
  let groupingInProgress = false;
  let domObserver = null;

  // 1. Inject Stylesheets for Main Collapsible Folders
  function injectStyles() {
    if (document.getElementById('swagger-custom-styles')) return;
    const style = document.createElement('style');
    style.id = 'swagger-custom-styles';
    style.textContent = `
      .swagger-main-folder {
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        margin-bottom: 16px;
        background: #f8fafc;
        overflow: hidden;
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
        font-family: system-ui, -apple-system, sans-serif;
      }
      .swagger-main-folder-header {
        padding: 16px 24px;
        background: #ffffff;
        cursor: pointer;
        display: flex;
        align-items: center;
        font-weight: 700;
        font-size: 16px;
        color: #1e293b;
        border-bottom: 1px solid #e2e8f0;
        user-select: none;
        transition: all 0.2s ease;
      }
      .swagger-main-folder-header:hover {
        background: #f1f5f9;
      }
      .swagger-main-folder-header .folder-icon {
        margin-right: 12px;
        font-size: 20px;
      }
      .swagger-main-folder-header .folder-title {
        flex-grow: 1;
      }
      .swagger-main-folder-header .folder-arrow {
        font-size: 14px;
        color: #64748b;
        transition: transform 0.2s ease;
      }
      .swagger-main-folder.collapsed .swagger-main-folder-content {
        display: none !important;
      }
      .swagger-main-folder-content {
        padding: 16px;
        background: #f8fafc;
      }
      .swagger-main-folder-content .opblock-tag-section {
        border: 1px solid #e2e8f0 !important;
        margin-bottom: 12px !important;
        border-radius: 8px !important;
        background: #ffffff !important;
        box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05) !important;
      }
      .swagger-main-folder-content .opblock-tag-section:last-child {
        margin-bottom: 0 !important;
      }
      .swagger-main-folder-content .opblock-tag {
        padding: 10px 18px !important;
        font-size: 14px !important;
        background: #f1f5f9 !important;
        border-bottom: 1px solid #e2e8f0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  // 2. React input trigger helper
  function setReactInputValue(input, val) {
    const lastValue = input.value;
    input.value = val;
    const event = new Event('input', { bubbles: true });
    const tracker = input._valueTracker;
    if (tracker) {
      tracker.setValue(lastValue);
    }
    input.dispatchEvent(event);
  }

  // 3. Sync inputs from LocalStorage
  function applyStoredValues() {
    PARAM_KEYS.forEach(key => {
      const storedVal = localStorage.getItem('swagger-param-' + key);
      if (!storedVal) return;

      const paramRows = document.querySelectorAll(`[data-param-name="${key}"]`);
      paramRows.forEach(row => {
        const input = row.querySelector('input, select');
        if (input && input.value !== storedVal) {
          setReactInputValue(input, storedVal);
        }
      });
    });
  }

  // 4. Save inputs to LocalStorage
  function setupInputListeners() {
    document.addEventListener('input', (e) => {
      const input = e.target;
      if (input.tagName === 'INPUT' || input.tagName === 'SELECT') {
        const row = input.closest('[data-param-name]');
        if (row) {
          const paramName = row.getAttribute('data-param-name');
          if (PARAM_KEYS.includes(paramName)) {
            localStorage.setItem('swagger-param-' + paramName, input.value);
            setTimeout(applyStoredValues, 50);
          }
        }
      }
    });
  }

  // 5. Group tag sections by prefix using " | "
  function groupSwaggerTags() {
    if (groupingInProgress) return;
    
    const tagSections = document.querySelectorAll('.opblock-tag-section');
    if (tagSections.length === 0) return;

    const firstSection = tagSections[0];
    const parentContainer = firstSection.parentNode;
    if (!parentContainer) return;

    groupingInProgress = true;

    // Disconnect temporarily to avoid loop triggers during re-append
    if (domObserver) domObserver.disconnect();

    tagSections.forEach(section => {
      const tagHeader = section.querySelector('h3.opblock-tag');
      if (!tagHeader) return;

      const fullTagName = tagHeader.getAttribute('data-tag') || tagHeader.textContent.trim();
      if (!fullTagName.includes('|')) return;

      const parts = fullTagName.split('|');
      const mainCategory = parts[0].trim();
      const subCategory = parts[1].trim();

      // Find or create the main folder accordion
      let folder = parentContainer.querySelector(`.swagger-main-folder[data-folder-name="${mainCategory}"]`);
      if (!folder) {
        folder = document.createElement('div');
        folder.className = 'swagger-main-folder collapsed'; // Start collapsed for clean folders
        folder.setAttribute('data-folder-name', mainCategory);
        
        const header = document.createElement('div');
        header.className = 'swagger-main-folder-header';
        header.innerHTML = `
          <span class="folder-icon">📁</span>
          <span class="folder-title">${mainCategory}</span>
          <span class="folder-arrow">▶</span>
        `;
        
        const content = document.createElement('div');
        content.className = 'swagger-main-folder-content';
        
        folder.appendChild(header);
        folder.appendChild(content);
        
        header.addEventListener('click', () => {
          folder.classList.toggle('collapsed');
          const arrow = header.querySelector('.folder-arrow');
          if (folder.classList.contains('collapsed')) {
            arrow.textContent = '▶';
          } else {
            arrow.textContent = '▼';
          }
        });

        parentContainer.insertBefore(folder, firstSection);
      }

      // Update nested tag title to show only subCategory
      const titleSpan = tagHeader.querySelector('span');
      if (titleSpan && titleSpan.textContent !== subCategory) {
        titleSpan.textContent = subCategory;
      }

      // Move tag section inside the folder content
      const content = folder.querySelector('.swagger-main-folder-content');
      if (content && section.parentNode !== content) {
        content.appendChild(section);
      }
    });

    // Restart the observer
    startObserver();
    groupingInProgress = false;
  }

  // 6. Monitor DOM updates
  function startObserver() {
    if (!domObserver) {
      domObserver = new MutationObserver((mutations) => {
        applyStoredValues();
        groupSwaggerTags();
      });
    }
    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initialize
  function init() {
    injectStyles();
    applyStoredValues();
    groupSwaggerTags();
    setupInputListeners();
    startObserver();
  }

  window.addEventListener('load', init);
  
  // Backup timeout initialization
  setTimeout(init, 1500);
})();
