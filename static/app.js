let demarcheData = null;
let dossiersData = [];
let selectedFields = [];
let selectedCategories = new Map();
let selectedFolder = null;
let apiToken = null;

function isProblematicDescriptor(descriptor) {
  const problematicTypenames = [
    "HeaderSectionChampDescriptor",
    "ExplicationChampDescriptor",
    "PieceJustificativeChamp",
  ];

  const problematicTypes = [
    "header_section",
    "explication",
    "piece_justificative",
  ];

  if (problematicTypenames.includes(descriptor.__typename)) {
    return true;
  }

  if (descriptor.type && problematicTypes.includes(descriptor.type)) {
    return true;
  }

  return false;
}

async function selectFolder() {
  // Vérifier si l'API est supportée
  if (!window.showDirectoryPicker) {
    alert(
      "⚠️ La sélection de dossier n'est pas supportée par votre navigateur.\n\n" +
        "Veuillez utiliser Chrome ou Edge pour utiliser cette fonctionnalité.",
    );
    return null;
  }

  try {
    const directoryHandle = await window.showDirectoryPicker({
      mode: "readwrite",
    });
    selectedFolder = directoryHandle;
    document.getElementById("folder-path").textContent = directoryHandle.name;
    return directoryHandle;
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Erreur sélection dossier:", err);
      alert("Erreur lors de la sélection du dossier");
    }
    return null;
  }
}

async function loadDemarche() {
  const token = document.getElementById("api-token").value.trim();
  const demarcheNumber = document.getElementById("demarche-number").value;
  const useProxy = document.getElementById("use-proxy").checked;

  if (!token) {
    alert("Veuillez entrer votre token API");
    return;
  }

  if (!demarcheNumber) {
    alert("Veuillez entrer un numéro de démarche");
    return;
  }

  apiToken = token;

  const spinner = document.getElementById("loading-spinner");
  const loadBtn = document.getElementById("load-demarche");
  spinner.style.display = "block";
  loadBtn.disabled = true;
  loadBtn.style.opacity = "0.6";

  try {
    const infoRes = await fetch(`/api/demarche/${demarcheNumber}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: apiToken, use_proxy: useProxy }),
    });

    if (!infoRes.ok) {
      const error = await infoRes.json();
      throw new Error(error.error || "Erreur lors du chargement");
    }

    demarcheData = await infoRes.json();

    const dossiersRes = await fetch(
      `/api/demarche/${demarcheNumber}/dossiers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: apiToken, use_proxy: useProxy }),
      },
    );

    if (!dossiersRes.ok) {
      const error = await dossiersRes.json();
      throw new Error(error.error || "Erreur lors du chargement des dossiers");
    }

    dossiersData = await dossiersRes.json();

    document.getElementById("demarche-title").textContent = demarcheData.title;
    document.getElementById("demarche-count").textContent = `${
      dossiersData.length
    } dossier${dossiersData.length > 1 ? "s" : ""}`;
    document.getElementById("demarche-info").style.display = "block";

    showFieldsSelection();
  } catch (error) {
    console.error("Erreur:", error);
    alert("Erreur: " + error.message);
  } finally {
    spinner.style.display = "none";
    loadBtn.disabled = false;
    loadBtn.style.opacity = "1";
  }
}

function showFieldsSelection() {
  document.getElementById("fields-section").style.display = "block";

  const fieldsContainer = document.getElementById("available-fields");

  const demandeurTypes = new Set();
  const availableDemandeurFields = new Set();
  const allAvailableFields = new Set();

  dossiersData.forEach((d) => {
    if (d.demandeur && d.demandeur.type) {
      demandeurTypes.add(d.demandeur.type);
      Object.keys(d.demandeur).forEach((key) => {
        if (key !== "type" && d.demandeur[key]) {
          availableDemandeurFields.add(key);
        }
      });
    }

    if (d.champs_values) {
      Object.keys(d.champs_values).forEach((fieldName) => {
        if (
          !["numero", "state", "dateDepot", "email_usager", "type"].includes(
            fieldName,
          )
        ) {
          allAvailableFields.add(fieldName);
        }
      });
    }
  });

  console.log(
    "🔍 Tous les champs disponibles:",
    Array.from(allAvailableFields),
  );

  let html = "";

  html += `
    <div class="field-category">
      <div class="field-category-title">📋 Système</div>
      <div class="fields-grid">
        <div class="field-checkbox-item">
          <input type="checkbox" id="field-sys-numero" value="numero" onchange="toggleField('numero', 0)">
          <label for="field-sys-numero">Numéro du dossier</label>
        </div>
        <div class="field-checkbox-item">
          <input type="checkbox" id="field-sys-state" value="state" onchange="toggleField('state', 1)">
          <label for="field-sys-state">État du dossier</label>
        </div>
        <div class="field-checkbox-item">
          <input type="checkbox" id="field-sys-dateDepot" value="dateDepot" onchange="toggleField('dateDepot', 2)">
          <label for="field-sys-dateDepot">Date de dépôt</label>
        </div>
        <div class="field-checkbox-item">
          <input type="checkbox" id="field-sys-nom-original" value="nom original du fichier" onchange="toggleField('nom original du fichier', 3)">
          <label for="field-sys-nom-original">Nom original du fichier</label>
        </div>
      </div>
    </div>
  `;

  if (demandeurTypes.has("PersonnePhysique")) {
    const physiquFields = [
      { key: "civilite", label: "Civilité" },
      { key: "nom", label: "Nom" },
      { key: "prenom", label: "Prénom" },
      { key: "email", label: "Email" },
    ].filter((f) => availableDemandeurFields.has(f.key));

    if (physiquFields.length > 0) {
      html += `
        <div class="field-category">
          <div class="field-category-title">👤 Demandeur (Personne physique)</div>
          <div class="fields-grid">
            ${physiquFields
              .map(
                (f, idx) => `
    <div class="field-checkbox-item">
      <input type="checkbox" id="field-physique-${f.key}" value="${
        f.key
      }" onchange="toggleField('${f.key}', ${100 + idx})">
      <label for="field-physique-${f.key}">${f.label}</label>
    </div>
  `,
              )
              .join("")}
          </div>
        </div>
      `;
    }
  }

  if (
    demandeurTypes.has("PersonneMorale") ||
    demandeurTypes.has("PersonneMoraleIncomplete")
  ) {
    const moraleFields = [
      { key: "raisonSociale", label: "Raison sociale" },
      { key: "siret", label: "SIRET" },
      { key: "siren", label: "SIREN" },
      { key: "nomCommercial", label: "Nom commercial" },
      { key: "formeJuridique", label: "Forme juridique" },
      { key: "ville", label: "Ville" },
      { key: "codePostal", label: "Code postal" },
      { key: "naf", label: "NAF" },
      { key: "rna", label: "RNA" },
      { key: "titre", label: "Titre" },
    ].filter((f) => availableDemandeurFields.has(f.key));

    if (moraleFields.length > 0) {
      html += `
        <div class="field-category">
          <div class="field-category-title">🏢 Demandeur (Personne morale)</div>
          <div class="fields-grid">
            ${moraleFields
              .map(
                (f, idx) => `
    <div class="field-checkbox-item">
      <input type="checkbox" id="field-morale-${f.key}" value="${
        f.key
      }" onchange="toggleField('${f.key}', ${200 + idx})">
      <label for="field-morale-${f.key}">${f.label}</label>
    </div>
  `,
              )
              .join("")}
          </div>
        </div>
      `;
    }
  }

  const allDescriptors = demarcheData.champDescriptors;
  const sections = [];
  let currentSection = { title: "Sans catégorie", fields: [] };

  if (allDescriptors && allDescriptors.length > 0) {
    allDescriptors.forEach((desc) => {
      if (desc.__typename === "HeaderSectionChampDescriptor") {
        if (currentSection.fields.length > 0) {
          sections.push(currentSection);
        }
        currentSection = { title: desc.label, fields: [] };
      } else if (
        !isProblematicDescriptor(desc) &&
        desc.__typename !== "RepetitionChampDescriptor" &&
        allAvailableFields.has(desc.label)
      ) {
        currentSection.fields.push(desc.label);
      }
    });

    if (currentSection.fields.length > 0) {
      sections.push(currentSection);
    }

    if (sections.length > 0) {
      let fieldIndex = 300;
      sections.forEach((section) => {
        html += `
        <div class="field-category">
          <div class="field-category-title">📝 ${section.title}</div>
          <div class="fields-grid">
      `;

        section.fields.forEach((fieldLabel) => {
          const safeId = "field-form-" + fieldIndex;
          const safeLabel = fieldLabel.replace(/'/g, "\\'");
          html += `
          <div class="field-checkbox-item">
            <input type="checkbox" id="${safeId}" value="${safeLabel}" onchange="toggleField('${safeLabel}', ${fieldIndex})">
            <label for="${safeId}">${fieldLabel}</label>
          </div>
        `;
          fieldIndex++;
        });

        html += `</div></div>`;
      });
    }
  }

  const repetitionFieldNames = new Set();

  dossiersData.forEach((d) => {
    if (d.champs_values && d.champs_values.__repetition_rows) {
      d.champs_values.__repetition_rows.forEach((row) => {
        Object.keys(row).forEach((fieldName) => {
          if (fieldName !== "__row_index") {
            repetitionFieldNames.add(fieldName);
          }
        });
      });
    }
  });

  if (repetitionFieldNames.size > 0) {
    console.log("📋 Champs de répétition trouvés:", repetitionFieldNames.size);

    html += `
    <div class="field-category">
      <div class="field-category-title">🔁 Champs des blocs répétables</div>
      <div class="fields-grid">
  `;

    let fieldIndex = 0;
    repetitionFieldNames.forEach((fieldName) => {
      const safeId = "field-rep-" + fieldIndex;
      const safeLabel = fieldName.replace(/'/g, "\\'");
      html += `
  <div class="field-checkbox-item">
    <input type="checkbox" id="${safeId}" value="${safeLabel}" onchange="toggleField('${safeLabel}', ${
      400 + fieldIndex
    })">
    <label for="${safeId}">${fieldName}</label>
  </div>
`;
      fieldIndex++;
    });

    html += `</div></div>`;
  } else {
    console.log("❌ Aucun champ de répétition trouvé");
  }

  fieldsContainer.innerHTML = html;
}

function toggleField(key, index) {
  const fieldId = `${key}_${index}`;
  const existingIndex = selectedFields.findIndex((f) => f.id === fieldId);

  if (existingIndex !== -1) {
    selectedFields.splice(existingIndex, 1);
  } else {
    selectedFields.push({ id: fieldId, name: key });
  }

  updateSelectedFieldsPreview();
}

function updateSelectedFieldsPreview() {
  const preview = document.getElementById("selected-fields-preview");
  const list = document.getElementById("selected-fields-list");
  const validateBtn = document.getElementById("validate-fields");

  if (selectedFields.length > 0) {
    preview.style.display = "block";
    validateBtn.style.display = "block";

    list.innerHTML = selectedFields
      .map(
        (field) =>
          `<span class="fr-tag fr-tag--sm fr-tag--blue-cumulus selected-field-tag">${field.name}</span>`,
      )
      .join("");
  } else {
    preview.style.display = "none";
    validateBtn.style.display = "none";
  }
}

function showCategoriesSelection() {
  document.getElementById("categories-section").style.display = "block";

  const categoriesMap = new Map();

  dossiersData.forEach((dossier) => {
    dossier.pieces_jointes.forEach((pj) => {
      if (!categoriesMap.has(pj.champ_label)) {
        categoriesMap.set(pj.champ_label, []);
      }
      categoriesMap.get(pj.champ_label).push({
        ...pj,
        dossier_number: dossier.number,
        champs_values: dossier.champs_values,
      });
    });
  });

  const categoriesList = document.getElementById("pj-categories-list");

  let html = "";
  let index = 0;
  categoriesMap.forEach((files, label) => {
    const safeId = "cat-" + index;
    const accordionId = "accordion-" + index;

    html += `
      <div class="category-item" id="category-item-${index}">
        <div class="category-header" onclick="toggleCategoryAccordion(event, ${index}, '${label.replace(
          /'/g,
          "\\'",
        )}')">
          <input type="checkbox" 
                 class="category-checkbox" 
                 id="${safeId}" 
                 data-category-label="${label}"
                 onchange="handleCheckboxChange(event, ${index}, '${label.replace(
                   /'/g,
                   "\\'",
                 )}')">
          <div class="category-info">
            <div class="category-name">${label}</div>
            <div class="category-count">${files.length} fichier(s) dans ${
              new Set(files.map((f) => f.dossier_number)).size
            } dossier(s)</div>
          </div>
        </div>
        
        <div class="category-accordion-content" id="${accordionId}">
          <div class="category-rename-config">
            <label for="pattern-${index}" class="pattern-label">Renommer le fichier :</label>
            <input type="text" 
                   id="pattern-${index}" 
                   data-category="${label}"
                   data-index="${index}"
                   class="pattern-input-full"
                   value="{numero}-{nom original du fichier}" 
                   placeholder="Ex: {numero}-{nom original du fichier}"
                   oninput="updateCategoryPattern(${index}, '${label.replace(
                     /'/g,
                     "\\'",
                   )}')">
            
            <p class="fields-helper-text">Cliquez sur les étiquettes que vous souhaitez intégrer au nom du fichier</p>
            
            <div class="fields-tags-container">
              ${selectedFields
                .map(
                  (field) =>
                    `<button type="button" class="fr-tag fr-tag--sm field-tag" onclick="insertFieldInAccordionFromTag(${index}, '${field.name.replace(
                      /'/g,
                      "\\'",
                    )}', '${label.replace(/'/g, "\\'")}')">${
                      field.name
                    }</button>`,
                )
                .join("")}
            </div>
            
            <div class="pattern-preview">
              <div class="pattern-preview-label">Aperçu :</div>
              <div class="pattern-preview-example" id="preview-${index}"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    index++;
  });

  categoriesList.innerHTML = html;
  window.availableCategories = categoriesMap;
}

function toggleCategoryAccordion(event, index, label) {
  if (event.target.type === "checkbox") {
    return;
  }

  const checkbox = document.getElementById("cat-" + index);
  const categoryItem = document.getElementById("category-item-" + index);
  const accordion = document.getElementById("accordion-" + index);

  checkbox.checked = !checkbox.checked;

  if (checkbox.checked) {
    categoryItem.classList.add("selected");
    accordion.classList.add("open");

    const pattern = document.getElementById(`pattern-${index}`).value;
    selectedCategories.set(label, {
      pattern: pattern,
      files: window.availableCategories.get(label),
    });

    updateCategoryPattern(index, label);
  } else {
    categoryItem.classList.remove("selected");
    accordion.classList.remove("open");
    selectedCategories.delete(label);
  }

  updateTotalFilesCount();
}

function handleCheckboxChange(event, index, label) {
  event.stopPropagation();

  const checkbox = document.getElementById("cat-" + index);
  const categoryItem = document.getElementById("category-item-" + index);
  const accordion = document.getElementById("accordion-" + index);

  if (checkbox.checked) {
    categoryItem.classList.add("selected");
    accordion.classList.add("open");

    const pattern = document.getElementById(`pattern-${index}`).value;
    selectedCategories.set(label, {
      pattern: pattern,
      files: window.availableCategories.get(label),
    });

    updateCategoryPattern(index, label);
  } else {
    categoryItem.classList.remove("selected");
    accordion.classList.remove("open");
    selectedCategories.delete(label);
  }

  updateTotalFilesCount();
}

function insertFieldInAccordionFromTag(index, field, label) {
  const input = document.getElementById(`pattern-${index}`);
  input.value += `{${field}}`;
  updateCategoryPattern(index, label);
}

function buildFileName(pattern, champsValues, pj) {
  let fileName = pattern;

  if (pj.row_index !== null && pj.row_index !== undefined) {
    // PJ dans une répétition
    fileName = fileName.replace(/\{([^}]+)\}/g, (match, fieldName) => {
      if (fieldName === "nom original du fichier") {
        return pj.filename.replace(/\.[^.]+$/, "");
      }

      const repetitionRows = champsValues.__repetition_rows;
      if (repetitionRows && repetitionRows[pj.row_index]) {
        const value = repetitionRows[pj.row_index][fieldName];
        if (value !== undefined && value !== null) {
          return sanitizeFilename(value);
        }
      }

      const matchingKey = Object.keys(champsValues).find(
        (key) =>
          key.toLowerCase() === fieldName.toLowerCase() &&
          key !== "__repetition_rows",
      );
      if (matchingKey && champsValues[matchingKey]) {
        return sanitizeFilename(champsValues[matchingKey]);
      }

      return match;
    });
  } else {
    // PJ hors répétition
    fileName = fileName.replace(/\{([^}]+)\}/g, (match, fieldName) => {
      if (fieldName === "nom original du fichier") {
        return pj.filename.replace(/\.[^.]+$/, "");
      }

      // Chercher d'abord une correspondance exacte
      const matchingKey = Object.keys(champsValues).find(
        (key) =>
          key.toLowerCase() === fieldName.toLowerCase() &&
          key !== "__repetition_rows",
      );
      if (matchingKey && champsValues[matchingKey]) {
        return sanitizeFilename(champsValues[matchingKey]);
      }

      // Si pas trouvé, chercher avec [0] par défaut (première ligne de répétition)
      const indexedKey = `${fieldName}[0]`;
      if (
        champsValues[indexedKey] !== undefined &&
        champsValues[indexedKey] !== null
      ) {
        return sanitizeFilename(champsValues[indexedKey]);
      }

      return match;
    });
  }

  return fileName;
}

function updateCategoryPattern(index, label) {
  const input = document.getElementById(`pattern-${index}`);
  const pattern = input.value;

  const data = selectedCategories.get(label);
  if (data && data.files.length > 0) {
    data.pattern = pattern;

    const previewEl = document.getElementById(`preview-${index}`);
    const sampleFile = data.files[0];

    const preview = buildFileName(
      pattern,
      sampleFile.champs_values,
      sampleFile,
    );
    const extension = sampleFile.filename.match(/\.[^.]+$/)?.[0] || "";
    previewEl.textContent = preview + extension;
  }
}

function updateTotalFilesCount() {
  let total = 0;
  selectedCategories.forEach((data) => {
    total += data.files.length;
  });

  const summary = document.getElementById("categories-summary");
  document.getElementById("total-files-count").textContent = total;
  summary.style.display = total > 0 ? "block" : "none";
}

async function downloadSelected() {
  if (!selectedFolder) {
    await selectFolder();
    if (!selectedFolder) return;
  }

  const useProxy = document.getElementById("use-proxy").checked;
  const CONCURRENCY = 6;

  // Réinitialiser la barre avant d'afficher
  document.getElementById("progress-fill").style.width = "0%";
  document.getElementById("progress-fill").textContent = "";
  document.getElementById("progress-text").textContent = "0%";

  document.getElementById("categories-section").style.display = "none";
  document.getElementById("progress-section").style.display = "block";
  // Réinitialiser les logs
  const logsContent = document.getElementById("download-logs-content");
  logsContent.innerHTML = "";

  // Construire la liste de toutes les tâches
  const tasks = [];
  for (const [categoryLabel, data] of selectedCategories) {
    for (const file of data.files) {
      tasks.push({ file, data });
    }
  }

  const totalFiles = tasks.length;
  let completed = 0;
  let errorCount = 0;

  // Verrou en mémoire pour éviter les collisions de noms entre téléchargements parallèles
  const reservedFilenames = new Set();

  async function downloadOne({ file, data }) {
    let newFilename = buildFileName(data.pattern, file.champs_values, file);
    const extension = file.filename.match(/\.[^.]+$/)?.[0] || "";
    newFilename = sanitizeFilename(newFilename) + extension;

    try {
      const response = await fetch("/api/download-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: file.url, use_proxy: useProxy }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();

      // Résolution du nom unique : vérifier en mémoire + sur disque
      let finalFilename = newFilename;
      let counter = 1;
      while (
        reservedFilenames.has(finalFilename) ||
        (await (async () => {
          try {
            await selectedFolder.getFileHandle(finalFilename, {
              create: false,
            });
            return true;
          } catch {
            return false;
          }
        })())
      ) {
        const namePart = newFilename.replace(extension, "");
        finalFilename = `${namePart}_${counter}${extension}`;
        counter++;
      }
      reservedFilenames.add(finalFilename);

      const fileHandle = await selectedFolder.getFileHandle(finalFilename, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      reservedFilenames.delete(finalFilename);
      completed++;
      addDownloadLog(file.dossier_number, finalFilename, "success");
    } catch (error) {
      console.error("Erreur:", error);
      errorCount++;
      addDownloadLog(file.dossier_number, newFilename, "error", error.message);
    }

    updateProgress(completed + errorCount, totalFiles);
  }

  // Pool de concurrence : max CONCURRENCY téléchargements en parallèle
  const pool = new Set();
  for (const task of tasks) {
    const p = downloadOne(task).finally(() => pool.delete(p));
    pool.add(p);
    if (pool.size >= CONCURRENCY) {
      await Promise.race(pool);
    }
  }
  // Attendre la fin des derniers téléchargements
  await Promise.allSettled(pool);

  const progressSection = document.getElementById("progress-section");
  const downloadComplete = document.getElementById("download-complete");

  if (errorCount > 0) {
    document.getElementById("progress-text").innerHTML =
      `⚠️ ${completed} fichier(s) téléchargé(s), ${errorCount} erreur(s)`;
  } else {
    document.getElementById("progress-text").innerHTML =
      `🎉 ${completed} fichier(s) téléchargé(s) dans ${selectedFolder.name}`;
  }

  document.querySelector("#progress-section .fr-h3").textContent =
    "Téléchargement terminé";

  progressSection.style.display = "block";
  downloadComplete.style.display = "block";
}

function addDownloadLog(dossierNumber, filename, status, errorMsg = null) {
  const logsContent = document.getElementById("download-logs-content");
  const timestamp = new Date().toLocaleTimeString();

  let icon, color, message;
  if (status === "success") {
    icon = "✅";
    color = "#18753C";
    message = `${icon} [${timestamp}] Dossier ${dossierNumber} - ${filename}`;
  } else {
    icon = "❌";
    color = "#CE0500";
    message = `${icon} [${timestamp}] Dossier ${dossierNumber} - ${filename} : ${errorMsg}`;
  }

  const logLine = document.createElement("div");
  logLine.style.color = color;
  logLine.style.marginBottom = "0.5rem";
  logLine.textContent = message;

  logsContent.appendChild(logLine);

  // Auto-scroll vers le bas
  logsContent.scrollTop = logsContent.scrollHeight;
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  const fill = document.getElementById("progress-fill");
  const text = document.getElementById("progress-text");

  fill.style.width = percent + "%";
  fill.textContent = percent + "%";
  text.textContent = `${current}/${total} fichiers`;
}

function sanitizeFilename(text) {
  if (!text) return "vide";
  return (
    String(text)
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")
      .trim() || "vide"
  );
}

function resetForNewDownload() {
  selectedCategories.clear();

  document.getElementById("categories-summary").style.display = "none";
  document.getElementById("progress-section").style.display = "none";
  document.getElementById("download-complete").style.display = "none";

  // Remettre la barre à zéro
  document.getElementById("progress-fill").style.width = "0%";
  document.getElementById("progress-fill").textContent = "";
  document.getElementById("progress-text").textContent = "";
  document.getElementById("download-logs-content").innerHTML = "";
  document.querySelector("#progress-section .fr-h3").textContent =
    "Téléchargement en cours...";

  document.getElementById("categories-section").style.display = "block";

  showCategoriesSelection();

  updateTotalFilesCount();
}

async function quitApp() {
  if (confirm("Voulez-vous vraiment quitter l'application ?")) {
    try {
      await fetch("/api/quit", { method: "POST" });
    } catch (e) {
      // Normal, le serveur s'est arrêté
    }
    document.body.innerHTML =
      '<div style="text-align:center;padding:100px;"><h1>✅ Application fermée</h1><p>Vous pouvez fermer cet onglet.</p></div>';
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const loadBtn = document.getElementById("load-demarche");
  const folderBtn = document.getElementById("select-folder");
  const validateBtn = document.getElementById("validate-fields");
  const downloadBtn = document.getElementById("download-btn");
  const quitBtn = document.getElementById("quit-app");

  if (loadBtn) loadBtn.addEventListener("click", loadDemarche);
  if (folderBtn) folderBtn.addEventListener("click", selectFolder);

  if (validateBtn) {
    validateBtn.addEventListener("click", async () => {
      if (selectedFields.length === 0) {
        alert("Veuillez sélectionner au moins un champ");
        return;
      }

      // Récupérer les dates et recharger les dossiers si nécessaire
      const dateDebut = document.getElementById("date-debut").value;
      const dateFin = document.getElementById("date-fin").value;

      // Si des dates sont spécifiées, recharger les dossiers filtrés
      if (dateDebut || dateFin) {
        const useProxy = document.getElementById("use-proxy").checked;
        const demarcheNumber = document.getElementById("demarche-number").value;

        try {
          const dossiersRes = await fetch(
            `/api/demarche/${demarcheNumber}/dossiers`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token: apiToken,
                use_proxy: useProxy,
                date_debut: dateDebut,
                date_fin: dateFin,
              }),
            },
          );

          if (!dossiersRes.ok) {
            const error = await dossiersRes.json();
            throw new Error(error.error || "Erreur lors du filtrage");
          }

          dossiersData = await dossiersRes.json();

          // Message informatif
          alert(
            `${dossiersData.length} dossier(s) trouvé(s) pour la période sélectionnée`,
          );
        } catch (error) {
          alert("Erreur lors du filtrage par dates: " + error.message);
          return;
        }
      }

      showCategoriesSelection();
    });
  }

  if (downloadBtn) downloadBtn.addEventListener("click", downloadSelected);
  if (quitBtn) quitBtn.addEventListener("click", quitApp);

  // Bouton pour appliquer le filtre de dates
  const applyDateFilterBtn = document.getElementById("apply-date-filter");
  if (applyDateFilterBtn) {
    applyDateFilterBtn.addEventListener("click", async () => {
      const dateDebut = document.getElementById("date-debut").value;
      const dateFin = document.getElementById("date-fin").value;

      if (!dateDebut && !dateFin) {
        alert("Veuillez sélectionner au moins une date");
        return;
      }

      const useProxy = document.getElementById("use-proxy").checked;
      const demarcheNumber = document.getElementById("demarche-number").value;

      try {
        applyDateFilterBtn.disabled = true;
        applyDateFilterBtn.textContent = "Filtrage en cours...";

        const dossiersRes = await fetch(
          `/api/demarche/${demarcheNumber}/dossiers`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: apiToken,
              use_proxy: useProxy,
              date_debut: dateDebut,
              date_fin: dateFin,
            }),
          },
        );

        if (!dossiersRes.ok) {
          const error = await dossiersRes.json();
          throw new Error(error.error || "Erreur lors du filtrage");
        }

        dossiersData = await dossiersRes.json();

        alert(
          `✅ ${dossiersData.length} dossier(s) trouvé(s) pour la période sélectionnée`,
        );

        // Recharger les catégories avec les dossiers filtrés
        showCategoriesSelection();
      } catch (error) {
        alert("❌ Erreur lors du filtrage : " + error.message);
      } finally {
        applyDateFilterBtn.disabled = false;
        applyDateFilterBtn.textContent = "Appliquer le filtre";
      }
    });
  }

  // Bouton pour réinitialiser le filtre de dates
  const resetDateFilterBtn = document.getElementById("reset-date-filter");
  if (resetDateFilterBtn) {
    resetDateFilterBtn.addEventListener("click", async () => {
      // Vider les champs de dates
      document.getElementById("date-debut").value = "";
      document.getElementById("date-fin").value = "";

      const useProxy = document.getElementById("use-proxy").checked;
      const demarcheNumber = document.getElementById("demarche-number").value;

      try {
        resetDateFilterBtn.disabled = true;
        resetDateFilterBtn.textContent = "Chargement...";

        // Recharger TOUS les dossiers (sans filtre)
        const dossiersRes = await fetch(
          `/api/demarche/${demarcheNumber}/dossiers`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: apiToken,
              use_proxy: useProxy,
            }),
          },
        );

        if (!dossiersRes.ok) {
          const error = await dossiersRes.json();
          throw new Error(error.error || "Erreur lors du rechargement");
        }

        dossiersData = await dossiersRes.json();

        alert(
          `✅ Filtre réinitialisé - ${dossiersData.length} dossier(s) au total`,
        );

        // Recharger les catégories avec tous les dossiers
        showCategoriesSelection();
      } catch (error) {
        alert("❌ Erreur lors de la réinitialisation : " + error.message);
      } finally {
        resetDateFilterBtn.disabled = false;
        resetDateFilterBtn.textContent = "Réinitialiser";
      }
    });
  }

  const newDownloadBtn = document.getElementById("new-download-btn");
  if (newDownloadBtn)
    newDownloadBtn.addEventListener("click", resetForNewDownload);
});
