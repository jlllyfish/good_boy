let demarcheData = null;
let dossiersData = [];
let selectedFields = [];
let selectedCategories = new Map();
let selectedFolder = null;
let apiToken = null;
let allDossiersData = []; // tous les dossiers chargés (avant filtre de dates)
let categoryLabels = []; // index -> libellé de catégorie
const fieldKeys = {}; // index -> clé de champ
const DEFAULT_PATTERN = "{numero}-{nom original du fichier}";
const MAX_BASENAME_LENGTH = 150; // marge pour le chemin complet sous Windows

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Même règle que l'ancien filtre serveur : on compare la partie date (AAAA-MM-JJ)
// de dateDepot ; les dossiers sans date de dépôt sont exclus
function filterByDepotDate(dossiers, dateDebut, dateFin) {
  return dossiers.filter((d) => {
    const depot = (d.champs_values?.dateDepot || "").slice(0, 10);
    if (!depot) return false;
    if (dateDebut && depot < dateDebut) return false;
    if (dateFin && depot > dateFin) return false;
    return true;
  });
}

function regField(index, key) {
  fieldKeys[index] = key;
  return index;
}

// Nom de base sûr pour Windows : longueur limitée, pas de point/espace final,
// pas de nom réservé (CON, NUL, COM1...)
function safeBaseName(name) {
  let base = String(name)
    .slice(0, MAX_BASENAME_LENGTH)
    .replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = "_" + base;
  return base || "vide";
}

function finalBaseName(pattern, pj) {
  return safeBaseName(
    sanitizeFilename(buildFileName(pattern, pj.champs_values, pj)),
  );
}

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

// Transforme une réponse d'erreur du serveur en Error enrichie
async function apiError(response, fallback) {
  let data = {};
  try {
    data = await response.json();
  } catch {}
  const error = new Error(data.error || fallback);
  error.allowedNetworks = data.allowed_networks;
  error.viaProxy = data.via_proxy;
  return error;
}

// Encadré d'erreur : créé à la volée s'il manque dans index.html
function getLoadErrorBox() {
  let box = document.getElementById("load-error");
  if (!box) {
    box = document.createElement("div");
    box.id = "load-error";
    box.className = "fr-alert fr-alert--error fr-mt-3w";
    box.style.display = "none";
    document.getElementById("demarche-info").after(box);
  }
  return box;
}

function hideLoadError() {
  const box = getLoadErrorBox();
  box.style.display = "none";
  box.innerHTML = "";
}

// Erreur affichée dans la page (texte sélectionnable), avec boutons
// « Copier » pour les réseaux à autoriser en cas de 403
function showLoadError(error) {
  const box = getLoadErrorBox();
  box.innerHTML = "";

  const title = document.createElement("h3");
  title.className = "fr-alert__title";
  const text = document.createElement("p");

  if (error.allowedNetworks !== undefined) {
    title.textContent = "Adresse IP non autorisée pour ce jeton";
    box.append(title);

    if (error.allowedNetworks.length) {
      text.textContent =
        "Ajoutez ce(s) réseau(x) dans les réseaux autorisés du jeton (Profil DN > jeton > Modifier) :";
      box.append(text);

      const list = document.createElement("ul");
      list.className = "ip-list";
      error.allowedNetworks.forEach((net) => {
        const li = document.createElement("li");
        const code = document.createElement("code");
        code.textContent = net;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fr-btn fr-btn--tertiary fr-btn--sm";
        btn.textContent = "Copier";
        btn.addEventListener("click", () => copyText(net, btn));
        li.append(code, btn);
        list.append(li);
      });
      box.append(list);
    } else {
      text.innerHTML =
        'Impossible de détecter l\'IP automatiquement : ouvrez <a href="https://api.ipify.org" target="_blank" rel="noopener noreferrer">api.ipify.org</a> depuis ce poste.';
      box.append(text);
    }

    if (error.viaProxy) {
      const note = document.createElement("p");
      note.className = "fr-text--sm";
      note.textContent =
        "Via le proxy, c'est l'IP de sortie du proxy qui est vue par DN : elle peut être partagée et changer selon le site.";
      box.append(note);
    }

    const link = document.createElement("p");
    link.innerHTML =
      '<a href="https://demarche.numerique.gouv.fr/profil" target="_blank" rel="noopener noreferrer">Ouvrir mon profil DN</a>';
    box.append(link);
  } else {
    title.textContent = "Erreur";
    text.textContent = error.message;
    box.append(title, text);
  }

  box.style.display = "block";
}

async function copyText(value, btn) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Repli si le presse-papier est refusé
    const tmp = document.createElement("textarea");
    tmp.value = value;
    document.body.append(tmp);
    tmp.select();
    document.execCommand("copy");
    tmp.remove();
  }
  const label = btn.textContent;
  btn.textContent = "Copié ✓";
  setTimeout(() => (btn.textContent = label), 1500);
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
  hideLoadError();

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

    if (!infoRes.ok) throw await apiError(infoRes, "Erreur lors du chargement");

    demarcheData = await infoRes.json();

    const dossiersRes = await fetch(
      `/api/demarche/${demarcheNumber}/dossiers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: apiToken, use_proxy: useProxy }),
      },
    );

    if (!dossiersRes.ok)
      throw await apiError(
        dossiersRes,
        "Erreur lors du chargement des dossiers",
      );

    dossiersData = await dossiersRes.json();
    allDossiersData = dossiersData;

    document.getElementById("demarche-title").textContent = demarcheData.title;
    document.getElementById("demarche-count").textContent = `${
      dossiersData.length
    } dossier${dossiersData.length > 1 ? "s" : ""}`;
    document.getElementById("demarche-info").style.display = "block";

    showFieldsSelection();
  } catch (error) {
    console.error("Erreur:", error);
    showLoadError(error);
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
          <input type="checkbox" id="field-sys-numero" value="numero" onchange="toggleField(${regField(0, "numero")})">
          <label for="field-sys-numero">Numéro du dossier</label>
        </div>
        <div class="field-checkbox-item">
          <input type="checkbox" id="field-sys-state" value="state" onchange="toggleField(${regField(1, "state")})">
          <label for="field-sys-state">État du dossier</label>
        </div>
        <div class="field-checkbox-item">
          <input type="checkbox" id="field-sys-dateDepot" value="dateDepot" onchange="toggleField(${regField(2, "dateDepot")})">
          <label for="field-sys-dateDepot">Date de dépôt</label>
        </div>
        <div class="field-checkbox-item">
          <input type="checkbox" id="field-sys-nom-original" value="nom original du fichier" onchange="toggleField(${regField(3, "nom original du fichier")})">
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
      }" onchange="toggleField(${regField(100 + idx, f.key)})">
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
      }" onchange="toggleField(${regField(200 + idx, f.key)})">
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
          <div class="field-category-title">📝 ${escapeHtml(section.title)}</div>
          <div class="fields-grid">
      `;

        section.fields.forEach((fieldLabel) => {
          const safeId = "field-form-" + fieldIndex;
          html += `
          <div class="field-checkbox-item">
            <input type="checkbox" id="${safeId}" onchange="toggleField(${regField(fieldIndex, fieldLabel)})">
            <label for="${safeId}">${escapeHtml(fieldLabel)}</label>
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
      html += `
  <div class="field-checkbox-item">
    <input type="checkbox" id="${safeId}" onchange="toggleField(${regField(400 + fieldIndex, fieldName)})">
    <label for="${safeId}">${escapeHtml(fieldName)}</label>
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

function toggleField(index) {
  const key = fieldKeys[index];
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
          `<span class="fr-tag fr-tag--sm fr-tag--blue-cumulus selected-field-tag">${escapeHtml(field.name)}</span>`,
      )
      .join("");
  } else {
    preview.style.display = "none";
    validateBtn.style.display = "none";
  }
}

function showCategoriesSelection() {
  document.getElementById("categories-section").style.display = "block";

  // Mémoriser la sélection actuelle (motifs compris) pour la réappliquer
  // aux nouvelles listes de fichiers, puis repartir de zéro : évite de
  // télécharger les fichiers d'avant le filtre de dates.
  const previous = new Map();
  selectedCategories.forEach((data, label) =>
    previous.set(label, data.pattern),
  );
  selectedCategories.clear();

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

  categoryLabels = Array.from(categoriesMap.keys());
  const categoriesList = document.getElementById("pj-categories-list");

  const tagsHtml = (index) =>
    selectedFields
      .map(
        (field, pos) =>
          `<button type="button" class="fr-tag fr-tag--sm field-tag" onclick="insertFieldInAccordionFromTag(${index}, ${pos})">${escapeHtml(
            field.name,
          )}</button>`,
      )
      .join("");

  let html = "";
  categoryLabels.forEach((label, index) => {
    const files = categoriesMap.get(label);
    const nbDossiers = new Set(files.map((f) => f.dossier_number)).size;

    html += `
      <div class="category-item" id="category-item-${index}">
        <div class="category-header" onclick="toggleCategoryAccordion(event, ${index})">
          <input type="checkbox" class="category-checkbox" id="cat-${index}"
                 onchange="handleCheckboxChange(event, ${index})">
          <div class="category-info">
            <div class="category-name">${escapeHtml(label)}</div>
            <div class="category-count">${files.length} fichier(s) dans ${nbDossiers} dossier(s)</div>
          </div>
        </div>

        <div class="category-accordion-content" id="accordion-${index}">
          <div class="category-rename-config">
            <label for="pattern-${index}" class="pattern-label">Renommer le fichier :</label>
            <input type="text" id="pattern-${index}" class="pattern-input-full"
                   value="${escapeHtml(previous.get(label) || DEFAULT_PATTERN)}"
                   placeholder="Ex: ${DEFAULT_PATTERN}"
                   oninput="updateCategoryPattern(${index})">

            <p class="fields-helper-text">Cliquez sur les étiquettes que vous souhaitez intégrer au nom du fichier</p>
            <div class="fields-tags-container">${tagsHtml(index)}</div>

            <div class="pattern-preview">
              <div class="pattern-preview-label">Aperçu :</div>
              <div class="pattern-preview-example" id="preview-${index}"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  categoriesList.innerHTML = html;
  window.availableCategories = categoriesMap;

  // Réappliquer la sélection précédente si la catégorie existe toujours
  categoryLabels.forEach((label, index) => {
    if (previous.has(label)) {
      document.getElementById("cat-" + index).checked = true;
      setCategorySelected(index, true);
    }
  });

  updateTotalFilesCount();
}

function setCategorySelected(index, checked) {
  const label = categoryLabels[index];
  const categoryItem = document.getElementById("category-item-" + index);
  const accordion = document.getElementById("accordion-" + index);

  if (checked) {
    categoryItem.classList.add("selected");
    accordion.classList.add("open");
    selectedCategories.set(label, {
      pattern: document.getElementById(`pattern-${index}`).value,
      files: window.availableCategories.get(label),
    });
    updateCategoryPattern(index);
  } else {
    categoryItem.classList.remove("selected");
    accordion.classList.remove("open");
    selectedCategories.delete(label);
  }

  updateTotalFilesCount();
}

function toggleCategoryAccordion(event, index) {
  if (event.target.type === "checkbox") return;
  const checkbox = document.getElementById("cat-" + index);
  checkbox.checked = !checkbox.checked;
  setCategorySelected(index, checkbox.checked);
}

function handleCheckboxChange(event, index) {
  event.stopPropagation();
  setCategorySelected(index, event.target.checked);
}

function insertFieldInAccordionFromTag(index, fieldPos) {
  const field = selectedFields[fieldPos];
  if (!field) return;
  const input = document.getElementById(`pattern-${index}`);
  input.value += `{${field.name}}`;
  updateCategoryPattern(index);
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
        (key) => key === fieldName && key !== "__repetition_rows",
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
        (key) => key === fieldName && key !== "__repetition_rows",
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

function updateCategoryPattern(index) {
  const pattern = document.getElementById(`pattern-${index}`).value;
  const data = selectedCategories.get(categoryLabels[index]);

  if (data && data.files.length > 0) {
    data.pattern = pattern;
    const sampleFile = data.files[0];
    const extension = sampleFile.filename.match(/\.[^.]+$/)?.[0] || "";
    document.getElementById(`preview-${index}`).textContent =
      finalBaseName(pattern, sampleFile) + extension;
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
  const CONCURRENCY = 6; // = limite de connexions du navigateur vers 127.0.0.1

  // Réinitialiser la barre avant d'afficher
  document.getElementById("progress-fill").style.width = "0%";
  document.getElementById("progress-fill").textContent = "";
  document.getElementById("progress-text").textContent = "0%";

  document.getElementById("categories-section").style.display = "none";
  document.getElementById("progress-section").style.display = "block";
  document
    .getElementById("download-loader")
    ?.style.setProperty("display", "block");
  // Réinitialiser les logs
  const logsContent = document.getElementById("download-logs-content");
  logsContent.innerHTML = "";

  // Construire la liste de toutes les tâches
  const tasks = [];
  for (const [, data] of selectedCategories) {
    for (const file of data.files) {
      tasks.push({ file, data });
    }
  }

  // Gros fichiers d'abord : évite qu'un gros fichier finisse seul à la fin
  tasks.sort((a, b) => (Number(b.file.size) || 0) - (Number(a.file.size) || 0));

  const totalFiles = tasks.length;
  let completed = 0;
  let errorCount = 0;

  // Noms déjà présents dans le dossier, lus une seule fois.
  // En minuscules car Windows ne distingue pas la casse.
  const usedNames = new Set();
  try {
    for await (const name of selectedFolder.keys()) {
      usedNames.add(name.toLowerCase());
    }
  } catch (e) {
    console.warn("Lecture du dossier impossible :", e);
  }

  // Réservation synchrone (aucun await) => pas de collision entre tâches parallèles
  function reserveName(baseName, extension) {
    let candidate = baseName + extension;
    let counter = 1;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${baseName}_${counter}${extension}`;
      counter++;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  async function downloadOne({ file, data }) {
    const extension = file.filename.match(/\.[^.]+$/)?.[0] || "";
    const baseName = finalBaseName(data.pattern, file);
    const finalFilename = reserveName(baseName, extension);
    let fileHandle = null;

    try {
      const response = await fetch("/api/download-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: file.url, use_proxy: useProxy }),
      });

      if (!response.ok) {
        let msg = `HTTP ${response.status}`;
        try {
          msg = (await response.json()).error || msg;
        } catch {}
        throw new Error(msg);
      }

      // Taille attendue : Content-Length du serveur, sinon taille annoncée par DS
      const expectedSize =
        Number(response.headers.get("Content-Length")) ||
        Number(file.size) ||
        0;

      fileHandle = await selectedFolder.getFileHandle(finalFilename, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      // Écriture au fil de l'eau, sans charger le fichier en mémoire
      // (pipeTo ferme le fichier en cas de succès, l'annule en cas d'erreur)
      await response.body.pipeTo(writable);

      // Contrôle d'intégrité : détecte un transfert coupé en cours de route
      if (expectedSize) {
        const written = (await fileHandle.getFile()).size;
        if (written !== expectedSize) {
          throw new Error(
            `fichier incomplet (${written} / ${expectedSize} octets)`,
          );
        }
      }

      completed++;
      addDownloadLog(file.dossier_number, finalFilename, "success");
    } catch (error) {
      console.error("Erreur:", error);
      // Supprimer un éventuel fichier vide ou tronqué
      if (fileHandle) {
        try {
          await selectedFolder.removeEntry(finalFilename);
        } catch {}
      }
      usedNames.delete(finalFilename.toLowerCase());
      errorCount++;
      addDownloadLog(
        file.dossier_number,
        finalFilename,
        "error",
        error.message,
      );
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
  document
    .getElementById("download-loader")
    ?.style.setProperty("display", "none");

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
    validateBtn.addEventListener("click", () => {
      if (selectedFields.length === 0) {
        alert("Veuillez sélectionner au moins un champ");
        return;
      }
      showCategoriesSelection();
    });
  }

  if (downloadBtn) downloadBtn.addEventListener("click", downloadSelected);
  if (quitBtn) quitBtn.addEventListener("click", quitApp);

  // Filtre de dates : appliqué localement, sans rappeler l'API
  const applyDateFilterBtn = document.getElementById("apply-date-filter");
  if (applyDateFilterBtn) {
    applyDateFilterBtn.addEventListener("click", () => {
      const dateDebut = document.getElementById("date-debut").value;
      const dateFin = document.getElementById("date-fin").value;

      if (!dateDebut && !dateFin) {
        alert("Veuillez sélectionner au moins une date");
        return;
      }
      if (dateDebut && dateFin && dateDebut > dateFin) {
        alert("La date de début doit précéder la date de fin");
        return;
      }

      dossiersData = filterByDepotDate(allDossiersData, dateDebut, dateFin);
      alert(
        `✅ ${dossiersData.length} dossier(s) trouvé(s) pour la période sélectionnée`,
      );
      showCategoriesSelection();
    });
  }

  const resetDateFilterBtn = document.getElementById("reset-date-filter");
  if (resetDateFilterBtn) {
    resetDateFilterBtn.addEventListener("click", () => {
      document.getElementById("date-debut").value = "";
      document.getElementById("date-fin").value = "";
      dossiersData = allDossiersData;
      alert(
        `✅ Filtre réinitialisé - ${dossiersData.length} dossier(s) au total`,
      );
      showCategoriesSelection();
    });
  }

  const newDownloadBtn = document.getElementById("new-download-btn");
  if (newDownloadBtn)
    newDownloadBtn.addEventListener("click", resetForNewDownload);
});
