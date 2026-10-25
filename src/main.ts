import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, getAllTags, moment, normalizePath } from "obsidian";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
// @ts-ignore
import { forceSimulation, forceLink, forceManyBody, forceCenter } from "d3-force-3d";

const VIEW_TYPE = "stellar-graph";
const PALETTES: Record<string, number[]> = {
  galaxy: [0x7aa2ff, 0xff7ab8, 0x7affc8, 0xffd27a, 0xb07aff, 0xff9a7a, 0x7ae6ff, 0xc8ff7a, 0xff7a7a, 0x9aa5c8],
  nebula: [0xa78bfa, 0xf0abfc, 0x93c5fd, 0x67e8f9, 0xfda4af, 0xc4b5fd, 0x86efac, 0xfde68a, 0xfdba74, 0x94a3b8],
  mono: [0xdbeafe, 0xbfdbfe, 0x93c5fd, 0x60a5fa, 0xe0e7ff, 0xc7d2fe, 0xa5b4fc, 0x818cf8, 0xf1f5f9, 0x94a3b8],
  cvd: [0xe69f00, 0x56b4e9, 0x009e73, 0xf0e442, 0x0072b2, 0xd55e00, 0xcc79a7, 0xffffff, 0x999999, 0x88ccee],
};
const AGE_STOPS = [0x9fc4ff, 0xeaf1ff, 0xffe29a, 0xff9a5a, 0xff5a4a].map((c) => new THREE.Color(c));
const GOLD = new THREE.Color(1, 0.86, 0.55);
const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0];

interface Settings {
  language: "auto" | "de" | "en";
  cometCount: number; glow: number; nebula: number; shootingStars: boolean; pulseDays: number; timeSeconds: number;
  holeMinLinks: number; excludeFolders: string; palette: string; ageBasis: "mtime" | "ctime";
  performance: boolean; cameraReverse: boolean; startView: "default" | "expansion" | "spiral"; spinClockwise: boolean;
  darkMatter: boolean; moons: boolean; planets: boolean; rings: boolean; lens: boolean;
  sound: boolean; volume: number; autoThrottle: boolean; subClusters: boolean; showStats: boolean; denseCore: boolean;
}
const DEFAULTS: Settings = {
  language: "auto", cometCount: 260, glow: 0.35, nebula: 1, shootingStars: true, pulseDays: 7, timeSeconds: 60,
  holeMinLinks: 10, excludeFolders: "", palette: "galaxy", ageBasis: "mtime",
  performance: false, cameraReverse: false, startView: "default", spinClockwise: true,
  darkMatter: true, moons: true, planets: true, rings: true, lens: true,
  sound: false, volume: 0.5, autoThrottle: true, subClusters: true, showStats: false, denseCore: false,
};

interface GNode { id: string; path: string; name: string; folder: string; deg: number; mtime: number; ctime: number; x?: number; y?: number; z?: number; }
interface GLink { source: string | GNode; target: string | GNode; }
interface Saved {
  cam?: number[]; target?: number[]; selected?: string[]; focusOn?: boolean;
  colorMode?: "folder" | "age"; expansion?: boolean; disc?: boolean; tilt?: number; spinSpeed?: number; colors?: Record<string, string>;
  pos?: Record<string, number[]>; query?: string; route?: string[]; tag?: string; sig?: string; mini?: number[];
}

// ---- Texte (Deutsch / Englisch) ----
const STR: Record<"de" | "en", Record<string, string>> = {
  de: {
    openGraph: "3D-Graph öffnen", rotation: "Rotation", focus: "Fokus", colorFolder: "Farbe: Ordner", colorAge: "Farbe: Alter",
    expansion: "Expansion", spiral: "Spirale", route: "Route", cinema: "Kino", photo: "Foto", video: "Video", sound: "Ton",
    reorder: "Neu ordnen", reset: "Reset", settings: "Einstellungen",
    focusTip: "Fokus: Hebt die gerade geöffnete Notiz als Zentralgestirn hervor und blendet den Rest ab. Die Kamera folgt, wenn du eine andere Notiz öffnest.",
    colorTipBtn: "Umschalten zwischen Ordnerfarben und Alters-Farben (frisch bläulich, verstaubt rötlich).",
    expansionTip: "Ordnet nach Alter wie ein expandierendes Universum: die ältesten Notizen außen, die frischesten im Kern.",
    spiralTip: "Drückt den Graphen zu einer drehenden Spiralgalaxie flach. Regler für Neigung und Drehung erscheinen.",
    routeTip: "Kürzester Link-Weg zwischen zwei Notizen: erst Start, dann Ziel anklicken. Esc beendet.",
    cinemaTip: "Kino: Automatische Kamerafahrt über die größten Hubs, ohne Bedienelemente. Klick oder Esc beendet.",
    photoTip: "Speichert ein Bild (PNG) des Graphen im Downloads-Ordner.",
    videoTip: "Nimmt den Graphen als Video (WebM) auf. Nochmal klicken beendet die Aufnahme.",
    soundTip: "Ambient-Klang und Töne beim Überfahren und Klicken an oder aus.",
    resetTip: "Kamera zurück zur Startansicht.",
    playTip: "Zeitreise abspielen oder pausieren.",
    speedTip: "Tempo der Zeitreise: 0,25× bis 4×.",
    sliderTip: "Zeitreise: Notizen nach ihrer Entstehung ein- und ausblenden.",
    miniTip: "Minimap: Klick verschiebt die Kamera dorthin. Ziehen dreht die Karte, Doppelklick setzt sie zurück.",
    searchTip: "Notiz suchen, oder mit # einen Tag als Sternbild anzeigen.",
    legendTip: "Klick: nur diesen Ordner zeigen (mehrere möglich). Klick auf den Punkt: Farbe ändern.",
    helpTitle: "Kurzanleitung", helpTip: "Kurzanleitung zeigen",
    help1: "Klick|Notiz neben dem Graphen öffnen", help2: "Strg/Cmd + Klick|Notiz in neuem Reiter öffnen",
    help3: "Doppelklick|Kamera zur Notiz fliegen", help4: "Ziehen · Mausrad|Drehen · Zoomen (rechte Maustaste verschiebt)",
    help5: "Legende|Klick filtert Ordner, Klick auf den Punkt ändert die Farbe", help6: "#tag in der Suche|Notizen eines Tags als Sternbild zeigen",
    help7: "Route|Kürzester Link-Weg zwischen zwei Notizen", help8: "Violette Punkte|Dunkle Materie: Links auf fehlende Notizen, Klick legt sie an",
    help9: "Rötliche / bläuliche Punkte|Monde: offene Aufgaben · Planeten: Anhänge", help10: "Zeitleiste|▶ abspielen · ⏺ als Video aufnehmen · Tempo-Knopf",
    help11: "Esc|Route, Sternbild, Hilfe oder Kinomodus beenden",
    throttle: "Niedrige Bildrate: Effekte wurden automatisch reduziert. Mehr Optionen in den Einstellungen (Performance-Modus).",
    sDense: "Dichter, heller Kern", sDenseD: "Schaltet die Helligkeits- und Dichte-Anpassungen für große Vaults ab: Im Expansionsmodus sitzen alle Notizen dicht im Kern, der Kern leuchtet maximal.",
    sStats: "Bildrate anzeigen", sStatsD: "Zeigt Bildrate, Zahl der Notizen und Links und die Effekt-Stufe oben im Graphen. Praktisch zum Testen großer Vaults.",
    sAuto: "Effekte automatisch drosseln", sAutoD: "Schaltet Kometen und Zusatzeffekte herunter, wenn die Bildrate dauerhaft niedrig ist.",
    sSub: "Unterordner als Sternhaufen", sSubD: "Notizen im selben Unterordner rücken enger zusammen.", tilt: "Neigung", spinSpeed: "Drehung",
    reorderTip: "Layout neu berechnen: Die Sterne ordnen sich anhand ihrer Verbindungen neu.", rotationTip: "Kamera-Rotation an oder aus", search: "Stern suchen … oder #tag", showAll: "Alle anzeigen",
    resetColors: "Farben zurücksetzen", ageLegend: "frisch  →  verstaubt", pulseHint: "✦ pulsiert = in den letzten {0} Tagen bearbeitet",
    today: "heute", colorTip: "Klick: Farbe ändern", ageNotice: "Zum Ändern der Ordnerfarben auf „Farbe: Ordner“ umschalten.",
    routeStart: "Route: Klick auf Start-Stern, dann auf Ziel-Stern.", routeFrom: "Start: {0} – jetzt das Ziel wählen.",
    routeNone: "Keine Verbindung zwischen diesen beiden Sternen.", routeChip: "Route · {0} Schritte",
    cardMeta: "{0} · {1} Links · {2}", cardTasks: "{0} offene Aufgaben", cardAttach: "{0} Anhänge", cardEmpty: "(leer)",
    dmTitle: "Dunkle Materie", dmInfo: "{0} Notizen verlinken hierher · Klick legt sie an",
    dmCreated: "Notiz „{0}“ angelegt.", dmFail: "Konnte „{0}“ nicht anlegen.",
    cineHint: "Klick oder Esc beendet den Kinomodus", photoSaved: "Foto gespeichert (Downloads-Ordner).",
    videoStart: "Aufnahme läuft – nochmal klicken zum Beenden.", videoSaved: "Video gespeichert (Downloads-Ordner).",
    videoUnsupported: "Videoaufnahme wird hier nicht unterstützt.", ringOld: "älteste", ringNew: "frischeste", timelapse: "Zeitraffer aufnehmen",
    sTitle: "Stellar Graph 3D", sLanguage: "Sprache", sLanguageD: "Sprache der Oberfläche.", sLangAuto: "Automatisch",
    sComets: "Kometen", sCometsD: "Anzahl der Lichtpunkte auf den Kanten. 0 schaltet sie ab.",
    sGlow: "Glow", sGlowD: "Stärke des Leuchtens (Bloom).", sNebula: "Nebel", sNebulaD: "Deckkraft der Ordner-Nebel.",
    sShooting: "Sternschnuppen", sShootingD: "Gelegentliche Sternschnuppen im Hintergrund.",
    sTime: "Dauer der Zeitreise (Sekunden)", sTimeD: "Wie lange ein Durchlauf von der ersten bis zur letzten Notiz dauert. Im Graphen zusätzlich per Tempo-Knopf änderbar.",
    sPulse: "Pulszeitraum (Tage)", sPulseD: "Notizen, die so kürzlich bearbeitet wurden, pulsieren.",
    sHoles: "Schwarze Löcher ab … Links", sHolesD: "Mindestzahl an Links, damit ein Hub zum schwarzen Loch wird.",
    sExclude: "Ordner ausblenden", sExcludeD: "Kommagetrennt, zum Beispiel: _archive, templates",
    sPalette: "Farbpalette", sPaletteD: "Vorbelegung der Ordnerfarben. Eigene Farben per Klick auf den Punkt in der Legende.",
    pGalaxy: "Galaxie", pNebula: "Nebel (pastell)", pMono: "Eisblau (einfarbig)", pCvd: "Farbfehlsichtigkeit (Okabe-Ito)",
    sAge: "Maß für das Alter", sAgeD: "Bestimmt Alters-Farben und Expansion.", aMtime: "Letzte Änderung", aCtime: "Erstellt",
    sPerf: "Performance-Modus", sPerfD: "Weniger Effekte für große Vaults oder schwache Rechner.",
    sStart: "Startansicht", sStartD: "Beim Öffnen des Graphen.", vDefault: "Letzte Ansicht", vExpansion: "Expansion", vSpiral: "Spirale",
    sCamRev: "Kamera-Rotation umkehren", sCamRevD: "Dreht nur die Kamera-Rotation um, falls sie sich entgegengesetzt zur Spirale anfühlt.",
    sSpin: "Drehrichtung im Uhrzeigersinn", sSpinD: "Gilt für Spirale und Kamera-Rotation. Aus = gegen den Uhrzeigersinn.",
    sDark: "Dunkle Materie", sDarkD: "Links auf nicht existierende Notizen als Geisterpunkte. Klick legt die Notiz an.",
    sMoons: "Monde", sMoonsD: "Offene Aufgaben kreisen als kleine Punkte um ihre Notiz.",
    sPlanets: "Planeten", sPlanetsD: "Verlinkte Anhänge (Bilder, PDFs) kreisen um ihre Notiz.",
    sRings: "Schalen-Ringe", sRingsD: "Orientierungsringe im Expansions-Modus.",
    sLens: "Gravitationslinse", sLensD: "Verzerrt das Bild um schwarze Löcher.",
    sSound: "Ton", sSoundD: "Sanfter Ambient-Klang und Töne beim Überfahren und Klicken.", sVolume: "Lautstärke",
  },
  en: {
    openGraph: "Open 3D graph", rotation: "Rotation", focus: "Focus", colorFolder: "Color: folder", colorAge: "Color: age",
    expansion: "Expansion", spiral: "Spiral", route: "Route", cinema: "Cinema", photo: "Photo", video: "Video", sound: "Sound",
    reorder: "Re-layout", reset: "Reset", settings: "Settings",
    focusTip: "Focus: highlights the note you have open as the central star and dims the rest. The camera follows when you open another note.",
    colorTipBtn: "Switch between folder colors and age colors (fresh bluish, dusty reddish).",
    expansionTip: "Arranges by age like an expanding universe: oldest notes outside, freshest in the core.",
    spiralTip: "Flattens the graph into a rotating spiral galaxy. Tilt and spin sliders appear.",
    routeTip: "Shortest link path between two notes: click the start, then the target. Esc cancels.",
    cinemaTip: "Cinema: automatic camera tour over the biggest hubs, without controls. Click or Esc exits.",
    photoTip: "Saves an image (PNG) of the graph to your Downloads folder.",
    videoTip: "Records the graph as a video (WebM). Click again to stop.",
    soundTip: "Ambient sound and tones on hover and click on or off.",
    resetTip: "Camera back to the start view.",
    playTip: "Play or pause the time travel.",
    speedTip: "Time travel speed: 0.25× to 4×.",
    sliderTip: "Time travel: show and hide notes by creation date.",
    miniTip: "Minimap: click moves the camera there. Drag to rotate the map, double click resets it.",
    searchTip: "Find a note, or type # to show a tag as a constellation.",
    legendTip: "Click: show only this folder (several possible). Click the dot: change color.",
    helpTitle: "Quick guide", helpTip: "Show quick guide",
    help1: "Click|Open the note beside the graph", help2: "Ctrl/Cmd + click|Open the note in a new tab",
    help3: "Double click|Fly the camera to the note", help4: "Drag · wheel|Rotate · zoom (right mouse button pans)",
    help5: "Legend|Click filters folders, click the dot to change its color", help6: "#tag in search|Show the notes of a tag as a constellation",
    help7: "Route|Shortest link path between two notes", help8: "Violet points|Dark matter: links to missing notes, click creates them",
    help9: "Reddish / bluish points|Moons: open tasks · Planets: attachments", help10: "Timeline|▶ play · ⏺ record as video · speed button",
    help11: "Esc|End route, constellation, guide or cinema mode",
    throttle: "Low frame rate: effects were reduced automatically. More options in the settings (performance mode).",
    sDense: "Dense, bright core", sDenseD: "Turns off the brightness and density adjustments for large vaults: in expansion layout all notes sit tightly in the core and the core glows at full strength.",
    sStats: "Show frame rate", sStatsD: "Shows frame rate, number of notes and links and the effect level at the top of the graph. Handy for testing large vaults.",
    sAuto: "Throttle effects automatically", sAutoD: "Turns down comets and extra effects when the frame rate stays low.",
    sSub: "Subfolders as star clusters", sSubD: "Notes in the same subfolder move closer together.", tilt: "Tilt", spinSpeed: "Spin",
    reorderTip: "Recompute the layout: stars settle again based on their links.", rotationTip: "Camera rotation on or off", search: "Find star … or #tag", showAll: "Show all",
    resetColors: "Reset colors", ageLegend: "fresh  →  dusty", pulseHint: "✦ pulsing = edited in the last {0} days",
    today: "today", colorTip: "Click: change color", ageNotice: "Switch to “Color: folder” to change folder colors.",
    routeStart: "Route: click a start star, then a target star.", routeFrom: "Start: {0} – now pick the target.",
    routeNone: "No connection between these two stars.", routeChip: "Route · {0} steps",
    cardMeta: "{0} · {1} links · {2}", cardTasks: "{0} open tasks", cardAttach: "{0} attachments", cardEmpty: "(empty)",
    dmTitle: "Dark matter", dmInfo: "{0} notes link here · click to create it",
    dmCreated: "Created note “{0}”.", dmFail: "Could not create “{0}”.",
    cineHint: "Click or Esc exits cinema mode", photoSaved: "Photo saved (Downloads folder).",
    videoStart: "Recording – click again to stop.", videoSaved: "Video saved (Downloads folder).",
    videoUnsupported: "Video recording is not supported here.", ringOld: "oldest", ringNew: "newest", timelapse: "Record timelapse",
    sTitle: "Stellar Graph 3D", sLanguage: "Language", sLanguageD: "Interface language.", sLangAuto: "Automatic",
    sComets: "Comets", sCometsD: "Number of light points running along links. 0 turns them off.",
    sGlow: "Glow", sGlowD: "Strength of the glow (bloom).", sNebula: "Nebulae", sNebulaD: "Opacity of the folder nebulae.",
    sShooting: "Shooting stars", sShootingD: "Occasional shooting stars in the background.",
    sTime: "Time travel duration (seconds)", sTimeD: "How long one run from the first to the last note takes. Also adjustable in the graph with the speed button.",
    sPulse: "Pulse period (days)", sPulseD: "Notes edited this recently pulse.",
    sHoles: "Black holes from … links", sHolesD: "Minimum links for a hub to become a black hole.",
    sExclude: "Hide folders", sExcludeD: "Comma separated, for example: _archive, templates",
    sPalette: "Color palette", sPaletteD: "Default folder colors. Pick your own by clicking the dot in the legend.",
    pGalaxy: "Galaxy", pNebula: "Nebula (pastel)", pMono: "Ice blue (monochrome)", pCvd: "Color-blind safe (Okabe-Ito)",
    sAge: "Measure of age", sAgeD: "Drives age colors and expansion.", aMtime: "Last modified", aCtime: "Created",
    sPerf: "Performance mode", sPerfD: "Fewer effects for large vaults or slow machines.",
    sStart: "Start view", sStartD: "When the graph opens.", vDefault: "Last view", vExpansion: "Expansion", vSpiral: "Spiral",
    sCamRev: "Reverse camera rotation", sCamRevD: "Reverses only the camera rotation, in case it feels opposite to the spiral.",
    sSpin: "Spin clockwise", sSpinD: "Applies to the spiral and the camera rotation. Off = counterclockwise.",
    sDark: "Dark matter", sDarkD: "Links to notes that do not exist yet as ghost points. A click creates the note.",
    sMoons: "Moons", sMoonsD: "Open tasks orbit their note as small points.",
    sPlanets: "Planets", sPlanetsD: "Linked attachments (images, PDFs) orbit their note.",
    sRings: "Shell rings", sRingsD: "Orientation rings in expansion mode.",
    sLens: "Gravitational lens", sLensD: "Bends the image around black holes.",
    sSound: "Sound", sSoundD: "Soft ambient sound plus tones on hover and click.", sVolume: "Volume",
  },
};
const resolveLang = (s: Settings): "de" | "en" => (s.language === "auto" ? (String(moment.locale()).startsWith("de") ? "de" : "en") : s.language);
const makeT = (lang: "de" | "en") => (key: string, ...args: (string | number)[]) =>
  (STR[lang][key] ?? key).replace(/\{(\d)\}/g, (_, n) => String(args[+n] ?? ""));

export default class StellarGraph3D extends Plugin {
  settings: Settings = { ...DEFAULTS };
  private refreshTimer = 0;

  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new GraphView(leaf, this));
    this.addRibbonIcon("orbit", makeT(resolveLang(this.settings))("openGraph"), () => this.open());
    this.addCommand({ id: "open", name: makeT(resolveLang(this.settings))("openGraph"), callback: () => this.open() });
    this.addSettingTab(new GraphSettingTab(this.app, this));
  }
  async open() {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async persist() {
    await this.saveData(this.settings);
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => (l.view as GraphView).refresh());
    }, 500);
  }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
}

class GraphSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: StellarGraph3D) { super(app, plugin); }
  display() {
    const el = this.containerEl;
    el.empty();
    const s = this.plugin.settings;
    const t = makeT(resolveLang(s));
    const save = () => this.plugin.persist();
    el.createEl("h2", { text: t("sTitle") });

    new Setting(el).setName(t("sLanguage")).setDesc(t("sLanguageD")).addDropdown((d) => d
      .addOption("auto", t("sLangAuto")).addOption("de", "Deutsch").addOption("en", "English")
      .setValue(s.language).onChange(async (v) => { s.language = v as Settings["language"]; await save(); this.display(); }));
    new Setting(el).setName(t("sStart")).setDesc(t("sStartD")).addDropdown((d) => d
      .addOption("default", t("vDefault")).addOption("expansion", t("vExpansion")).addOption("spiral", t("vSpiral"))
      .setValue(s.startView).onChange(async (v) => { s.startView = v as Settings["startView"]; await save(); }));
    new Setting(el).setName(t("sSpin")).setDesc(t("sSpinD")).addToggle((x) => x.setValue(s.spinClockwise).onChange(async (v) => { s.spinClockwise = v; await save(); }));

    new Setting(el).setName(t("sPalette")).setDesc(t("sPaletteD")).addDropdown((d) => d
      .addOption("galaxy", t("pGalaxy")).addOption("nebula", t("pNebula")).addOption("mono", t("pMono")).addOption("cvd", t("pCvd"))
      .setValue(s.palette).onChange(async (v) => { s.palette = v; await save(); }));
    new Setting(el).setName(t("sAge")).setDesc(t("sAgeD")).addDropdown((d) => d
      .addOption("mtime", t("aMtime")).addOption("ctime", t("aCtime"))
      .setValue(s.ageBasis).onChange(async (v) => { s.ageBasis = v as Settings["ageBasis"]; await save(); }));
    new Setting(el).setName(t("sExclude")).setDesc(t("sExcludeD")).addText((x) => x.setPlaceholder("_archive, templates").setValue(s.excludeFolders).onChange(async (v) => { s.excludeFolders = v; await save(); }));
    new Setting(el).setName(t("sPulse")).setDesc(t("sPulseD")).addSlider((x) => x.setLimits(1, 60, 1).setValue(s.pulseDays).setDynamicTooltip().onChange(async (v) => { s.pulseDays = v; await save(); }));

    new Setting(el).setName(t("sTime")).setDesc(t("sTimeD")).addSlider((x) => x.setLimits(10, 300, 5).setValue(s.timeSeconds).setDynamicTooltip().onChange(async (v) => { s.timeSeconds = v; await save(); }));
    new Setting(el).setName(t("sGlow")).setDesc(t("sGlowD")).addSlider((x) => x.setLimits(0, 1.5, 0.05).setValue(s.glow).setDynamicTooltip().onChange(async (v) => { s.glow = v; await save(); }));
    new Setting(el).setName(t("sNebula")).setDesc(t("sNebulaD")).addSlider((x) => x.setLimits(0, 2, 0.1).setValue(s.nebula).setDynamicTooltip().onChange(async (v) => { s.nebula = v; await save(); }));
    new Setting(el).setName(t("sComets")).setDesc(t("sCometsD")).addSlider((x) => x.setLimits(0, 600, 20).setValue(s.cometCount).setDynamicTooltip().onChange(async (v) => { s.cometCount = v; await save(); }));
    new Setting(el).setName(t("sHoles")).setDesc(t("sHolesD")).addSlider((x) => x.setLimits(3, 40, 1).setValue(s.holeMinLinks).setDynamicTooltip().onChange(async (v) => { s.holeMinLinks = v; await save(); }));

    const toggles: [keyof Settings, string][] = [
      ["shootingStars", "Shooting"], ["darkMatter", "Dark"], ["moons", "Moons"], ["planets", "Planets"], ["rings", "Rings"], ["lens", "Lens"], ["performance", "Perf"], ["cameraReverse", "CamRev"], ["autoThrottle", "Auto"], ["subClusters", "Sub"], ["showStats", "Stats"], ["denseCore", "Dense"], ["sound", "Sound"],
    ];
    toggles.forEach(([key, k]) => new Setting(el).setName(t("s" + k)).setDesc(t("s" + k + "D"))
      .addToggle((x) => x.setValue(s[key] as boolean).onChange(async (v) => { (s[key] as boolean) = v; await save(); })));
    new Setting(el).setName(t("sVolume")).addSlider((x) => x.setLimits(0, 1, 0.05).setValue(s.volume).setDynamicTooltip().onChange(async (v) => { s.volume = v; await save(); }));
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const hash = (a: number, b: number) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
const fnv = (s: string) => { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return h >>> 0; };
const ageColor = (time: number) => {
  const d = Math.max(0, (Date.now() - time) / 864e5);
  const t = Math.min(1, Math.log10(1 + d) / Math.log10(1 + 720));
  const f = t * (AGE_STOPS.length - 1);
  const k = Math.min(AGE_STOPS.length - 2, Math.floor(f));
  return AGE_STOPS[k].clone().lerp(AGE_STOPS[k + 1], f - k);
};
const saveBlob = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0.6)"); gr.addColorStop(0.45, "rgba(255,255,255,0.18)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function rippleTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.72, "rgba(255,255,255,0)");
  gr.addColorStop(0.86, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function diskTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,230,190,0)"); gr.addColorStop(0.44, "rgba(255,230,190,0)");
  gr.addColorStop(0.5, "rgba(255,240,215,1)"); gr.addColorStop(0.68, "rgba(255,190,120,0.55)");
  gr.addColorStop(1, "rgba(255,150,80,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const cg = (g as any).createConicGradient?.(0, 128, 128);
  if (cg) {
    cg.addColorStop(0, "rgba(0,0,0,1)"); cg.addColorStop(0.25, "rgba(0,0,0,0.35)"); cg.addColorStop(0.5, "rgba(0,0,0,1)");
    cg.addColorStop(0.78, "rgba(0,0,0,0.4)"); cg.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-in"; g.fillStyle = cg; g.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(c);
}

const LENS_SHADER = {
  uniforms: { tDiffuse: { value: null }, uHoles: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }, uAspect: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uHoles[3]; uniform float uAspect; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      for (int i = 0; i < 3; i++) {
        vec3 h = uHoles[i];
        if (h.z <= 0.0) continue;
        vec2 d = vUv - h.xy; d.x *= uAspect;
        float r = length(d);
        float R = h.z * 1.7;
        float s = R * R / (r * r + R * R * 0.15);
        vec2 off = (d / (r + 1e-5)) * s * 0.35 * R;
        off.x /= uAspect;
        uv -= off;
      }
      gl_FragColor = texture2D(tDiffuse, uv);
    }`,
};

class GraphView extends ItemView {
  private renderer?: THREE.WebGLRenderer;
  private composer?: EffectComposer;
  private raf = 0;
  private ro?: ResizeObserver;
  private disposeFns: (() => void)[] = [];
  private onFile?: (f: TFile | null) => void;
  private live?: { modify(path: string): void; structural(): void; resolved(): void };
  private state: Saved | null = null;
  private rebuildTimer = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: StellarGraph3D) { super(leaf); }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Stellar Graph 3D"; }
  getIcon() { return "orbit"; }

  private storeKey() { return "stellar-graph:" + this.app.vault.getName(); }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("n3d-root");
    root.style.padding = "0";
    try { const raw = window.localStorage.getItem(this.storeKey()); if (raw) this.state = JSON.parse(raw); } catch { /* ohne Gedächtnis weiter */ }
    const sv = this.plugin.settings.startView;
    if (sv !== "default") {
      this.state = { ...(this.state ?? {}), expansion: true, disc: sv === "spiral" };
      if (sv === "spiral") { this.state.cam = [0, 0, 320]; this.state.target = [0, 0, 0]; }
    }
    const md = (f: unknown): f is TFile => f instanceof TFile && f.extension === "md";
    this.registerEvent(this.app.workspace.on("file-open", (f) => this.onFile?.(f)));
    this.registerEvent(this.app.vault.on("modify", (f) => { if (md(f)) this.live?.modify(f.path); }));
    this.registerEvent(this.app.vault.on("create", (f) => { if (md(f)) this.live?.structural(); }));
    this.registerEvent(this.app.vault.on("delete", (f) => { if (md(f)) this.live?.structural(); }));
    this.registerEvent(this.app.vault.on("rename", (f) => { if (md(f)) this.live?.structural(); }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.live?.resolved()));
    this.build(root, false);
  }

  async onClose() {
    window.clearTimeout(this.rebuildTimer);
    this.teardown();
  }

  refresh() { this.scheduleRebuild(60); }

  private teardown() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.disposeFns.forEach((f) => f());
    this.disposeFns = [];
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = undefined;
    this.live = undefined;
    this.onFile = undefined;
  }

  private scheduleRebuild(delay = 1500) {
    window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.teardown();
      this.contentEl.empty();
      this.build(this.contentEl, true);
    }, delay);
  }

  private build(root: HTMLElement, rebuilt: boolean) {
    const st: Saved = this.state ?? {};
    const S = this.plugin.settings;
    const t = makeT(resolveLang(S));
    const lang = resolveLang(S);
    const dateLoc = lang === "de" ? "de-DE" : "en-US";
    const spin = S.spinClockwise ? 1 : -1;
    const baseRot = -0.35 * spin * (S.cameraReverse ? -1 : 1);

    // ---- Daten ----
    const resolved = this.app.metadataCache.resolvedLinks;
    const unresolved = this.app.metadataCache.unresolvedLinks;
    const excluded = S.excludeFolders.split(",").map((x) => x.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
    const files = this.app.vault.getMarkdownFiles().filter((f) => !excluded.some((e) => f.path.startsWith(e + "/") || f.path === e + ".md"));
    const nodes: GNode[] = files.map((f) => ({
      id: f.path, path: f.path, name: f.basename,
      folder: f.path.includes("/") ? f.path.split("/")[0] : "(root)",
      deg: 0, mtime: f.stat.mtime, ctime: f.stat.ctime || f.stat.mtime,
    }));
    const N = nodes.length;
    // Expansionsschalen: bei vielen Notizen flacher als linear, damit der Kern nicht ausbrennt
    const shellP = S.denseCore ? 1 : 1 - 0.5 * Math.min(1, Math.max(0, (N - 600) / 2000));
    const shell = (f: number) => 34 + 210 * Math.pow(Math.max(0, Math.min(1, f)), shellP);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const ageOf = (n: GNode) => (S.ageBasis === "ctime" ? n.ctime : n.mtime);
    const links: GLink[] = [];
    const adjIds = new Map<string, string[]>();
    for (const [src, targets] of Object.entries(resolved)) {
      if (!byId.has(src)) continue;
      for (const tgt of Object.keys(targets)) {
        if (src === tgt || !byId.has(tgt)) continue;
        links.push({ source: src, target: tgt });
        byId.get(src)!.deg++; byId.get(tgt)!.deg++;
        (adjIds.get(src) ?? adjIds.set(src, []).get(src)!).push(tgt);
        (adjIds.get(tgt) ?? adjIds.set(tgt, []).get(tgt)!).push(src);
      }
    }
    const sigOf = () => {
      let h = 0;
      for (const n of nodes) {
        const r = resolved[n.id];
        if (r) for (const k of Object.keys(r)) if (byId.has(k)) h = (h + fnv(n.id + ">" + k)) | 0;
        const u = unresolved[n.id];
        if (u) for (const k of Object.keys(u)) h = (h + fnv(n.id + "?" + k)) | 0;
      }
      return h;
    };
    let linkSig = sigOf();

    const folders = [...new Set(nodes.map((n) => n.folder))].sort();
    const palette = PALETTES[S.palette] ?? PALETTES.galaxy;
    const custom: Record<string, string> = { ...(st.colors ?? {}) };
    const colorOf = (f: string) => new THREE.Color((custom[f] ?? palette[folders.indexOf(f) % palette.length]) as THREE.ColorRepresentation);
    const baseCols = nodes.map((n) => colorOf(n.folder));
    const orphans = nodes.filter((n) => n.deg === 0);
    const isOrphan = nodes.map((n) => n.deg === 0);
    const holeNodes = [...nodes].sort((a, b) => b.deg - a.deg).slice(0, 3).filter((n) => n.deg >= S.holeMinLinks);
    const isHole = nodes.map((n) => holeNodes.includes(n));

    // Tags, Aufgaben, Anhänge
    const tagIndex = new Map<string, Set<number>>();
    const tagsOf: string[][] = nodes.map(() => []);
    const taskCount = nodes.map(() => 0);
    const planetCount = nodes.map(() => 0);
    files.forEach((f, i) => {
      const c = this.app.metadataCache.getFileCache(f);
      const tags = [...new Set((c ? getAllTags(c) : null) ?? [])];
      tagsOf[i] = tags;
      tags.forEach((tg) => (tagIndex.get(tg) ?? tagIndex.set(tg, new Set()).get(tg)!).add(i));
      taskCount[i] = (c?.listItems ?? []).filter((li) => li.task === " ").length;
      planetCount[i] = Object.keys(resolved[f.path] ?? {}).filter((tg) => !byId.has(tg) && !tg.toLowerCase().endsWith(".md")).length;
    });

    // Dunkle Materie: Links auf noch nicht existierende Notizen
    const dmMap = new Map<string, number[]>();
    if (S.darkMatter) {
      for (const [src, tg] of Object.entries(unresolved)) {
        const si = idx.get(src); if (si === undefined) continue;
        for (const name of Object.keys(tg)) {
          if (/\.[a-z0-9]{2,5}$/i.test(name) && !name.toLowerCase().endsWith(".md")) continue;
          (dmMap.get(name) ?? dmMap.set(name, []).get(name)!).push(si);
        }
      }
    }
    const dms = [...dmMap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 300).map(([name, srcs], k) => {
      const th = hash(k, 5) * Math.PI * 2, ph = Math.acos(2 * hash(k, 6) - 1);
      return { name, srcs: [...new Set(srcs)], off: new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)).multiplyScalar(16 + hash(k, 7) * 12) };
    });

    // Positionen vom letzten Mal / vom letzten Aufbau
    const births: number[] = [];
    const ghosts: THREE.Vector3[] = [];
    let restored = 0;
    if (st.pos) {
      nodes.forEach((n) => { const p = st.pos![n.id]; if (p) { n.x = p[0]; n.y = p[1]; n.z = p[2]; restored++; } });
      nodes.forEach((n, i) => {
        if (n.x !== undefined) return;
        const nb = (adjIds.get(n.id) ?? []).map((id) => byId.get(id)!).find((m) => m.x !== undefined);
        if (nb) { n.x = nb.x! + rnd(-6, 6); n.y = nb.y! + rnd(-6, 6); n.z = nb.z! + rnd(-6, 6); }
        if (rebuilt) births.push(i);
      });
      if (rebuilt) Object.keys(st.pos).forEach((id) => { if (!byId.has(id)) { const p = st.pos![id]; ghosts.push(new THREE.Vector3(p[0], p[1], p[2])); } });
    }

    // ---- Szene ----
    const w = () => root.clientWidth || 800, h = () => root.clientHeight || 600;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, w() / h(), 0.1, 5000);
    camera.position.set(0, 0, 320);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(S.performance ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w(), h());
    renderer.setClearColor(0x000000, 0);
    root.appendChild(renderer.domElement);
    this.renderer = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.autoRotate = true; controls.autoRotateSpeed = baseRot;
    if (st.cam && st.target) {
      camera.position.set(st.cam[0], st.cam[1], st.cam[2]);
      controls.target.set(st.target[0], st.target[1], st.target[2]);
      controls.autoRotate = false;
    }
    let fly: { t: number; dur: number; fp: THREE.Vector3; ft: THREE.Vector3; tp: THREE.Vector3; tt: THREE.Vector3 } | null = null;
    const tourQ: number[] = [];

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w(), h()), S.glow * (S.denseCore ? 1 : Math.min(1, Math.pow(1500 / Math.max(N, 1), 0.4))), S.performance ? 0.3 : 0.45, 0.55));
    const lensPass = new ShaderPass(LENS_SHADER);
    lensPass.enabled = S.lens && !S.performance && holeNodes.length > 0;
    composer.addPass(lensPass);
    composer.addPass(new OutputPass());
    this.composer = composer;

    // Sternenstaub
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 2400;
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.2, color: 0x8a94c8, transparent: true, opacity: 0.5, depthWrite: false }));
    scene.add(stars);

    // Knoten
    const sphere = new THREE.SphereGeometry(1, 20, 20);
    const meshes: THREE.Mesh[] = nodes.map((n) => {
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.scale.setScalar(1.3 + Math.sqrt(n.deg) * 0.7);
      m.userData.node = n;
      m.userData.base = m.scale.x;
      scene.add(m);
      return m;
    });
    const P = nodes.map(() => new THREE.Vector3());
    const appear = nodes.map((_, i) => (births.includes(i) ? 0 : 1));
    const flash = nodes.map(() => 0);
    const lastPulse = nodes.map(() => -99);
    const recentCut = Date.now() - S.pulseDays * 864e5;
    const recent = nodes.map((n) => n.mtime > recentCut);

    // Schwarze Löcher
    const diskTex = diskTexture();
    const disks = holeNodes.map((n, k) => {
      const mat = new THREE.MeshBasicMaterial({ map: diskTex, color: colorOf(n.folder).lerp(new THREE.Color(0xffffff), 0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      mesh.rotation.x = 1.1 + k * 0.15; mesh.rotation.y = 0.35 * (k + 1);
      scene.add(mesh);
      return { n, i: idx.get(n.id)!, mesh, mat };
    });

    // Kanten
    const linePos = new Float32Array(links.length * 6);
    const lineCol = new Float32Array(links.length * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute("color", new THREE.BufferAttribute(lineCol, 3));
    scene.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })));

    // Sternbild-Linien (Tag)
    const conPos = new Float32Array(Math.max(1, N) * 6);
    const conGeo = new THREE.BufferGeometry();
    conGeo.setAttribute("position", new THREE.BufferAttribute(conPos, 3));
    conGeo.setDrawRange(0, 0);
    const conLine = new THREE.LineSegments(conGeo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    conLine.frustumCulled = false; scene.add(conLine);
    let conEdges: [number, number][] = [];

    // Dunkle Materie: Punkte + Verbindungslinien
    const dmCount = dms.length;
    const dmP = dms.map(() => new THREE.Vector3());
    const dmPosArr = new Float32Array(dmCount * 3), dmColArr = new Float32Array(dmCount * 3);
    const dmGeo = new THREE.BufferGeometry();
    dmGeo.setAttribute("position", new THREE.BufferAttribute(dmPosArr, 3));
    dmGeo.setAttribute("color", new THREE.BufferAttribute(dmColArr, 3));
    const dmPoints = new THREE.Points(dmGeo, new THREE.PointsMaterial({ size: 3.4, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    dmPoints.frustumCulled = false; scene.add(dmPoints);
    const dmSegs: [number, number][] = [];
    dms.forEach((d, k) => d.srcs.slice(0, 6).forEach((s) => dmSegs.push([k, s])));
    const dmLinePos = new Float32Array(dmSegs.length * 6), dmLineCol = new Float32Array(dmSegs.length * 6);
    const dmLineGeo = new THREE.BufferGeometry();
    dmLineGeo.setAttribute("position", new THREE.BufferAttribute(dmLinePos, 3));
    dmLineGeo.setAttribute("color", new THREE.BufferAttribute(dmLineCol, 3));
    const dmLines = new THREE.LineSegments(dmLineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    dmLines.frustumCulled = false; scene.add(dmLines);
    const DM_COL = new THREE.Color(0x8f7bff);

    // Monde (offene Aufgaben) und Planeten (Anhänge)
    interface Orb { i: number; planet: boolean; phase: number; speed: number; u: THREE.Vector3; v: THREE.Vector3; }
    const orbs: Orb[] = [];
    if (!S.performance) {
      nodes.forEach((_, i) => {
        const th = hash(i, 1) * Math.PI * 2, ph = Math.acos(2 * hash(i, 2) - 1);
        const nrm = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
        const u = new THREE.Vector3().crossVectors(nrm, new THREE.Vector3(0, 1, 0));
        if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
        u.normalize();
        const v = new THREE.Vector3().crossVectors(nrm, u).normalize();
        if (S.moons) for (let k = 0; k < Math.min(6, taskCount[i]); k++) orbs.push({ i, planet: false, phase: hash(i, k + 3) * Math.PI * 2, speed: 0.8 + hash(i, k + 9) * 0.4, u, v });
        if (S.planets) for (let k = 0; k < Math.min(5, planetCount[i]); k++) orbs.push({ i, planet: true, phase: hash(i, k + 13) * Math.PI * 2, speed: (0.22 + hash(i, k + 19) * 0.12) * (k % 2 ? -1 : 1), u, v });
      });
    }
    const orbPos = new Float32Array(orbs.length * 3), orbCol = new Float32Array(orbs.length * 3);
    const orbGeo = new THREE.BufferGeometry();
    orbGeo.setAttribute("position", new THREE.BufferAttribute(orbPos, 3));
    orbGeo.setAttribute("color", new THREE.BufferAttribute(orbCol, 3));
    const orbPoints = new THREE.Points(orbGeo, new THREE.PointsMaterial({ size: 2.5, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    orbPoints.frustumCulled = false; scene.add(orbPoints);

    // Expansions-Ringe
    const ringGroup = new THREE.Group();
    const ringMat = new THREE.LineBasicMaterial({ color: 0x7c86b8, transparent: true, opacity: 0, depthWrite: false });
    [0, 0.33, 0.66, 1].forEach((q) => {
      const R = shell(q), pts: THREE.Vector3[] = [];
      for (let k = 0; k < 128; k++) pts.push(new THREE.Vector3(Math.cos((k / 128) * Math.PI * 2) * R, 0, Math.sin((k / 128) * Math.PI * 2) * R));
      ringGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    });
    ringGroup.visible = false;
    scene.add(ringGroup);

    // ---- Layout ----
    const sim = forceSimulation(nodes, 3)
      .force("link", forceLink(links).id((d: GNode) => d.id).distance(34).strength(0.4))
      .force("charge", forceManyBody().strength(-140))
      .force("center", forceCenter(0, 0, 0))
      .alphaDecay(0.02);
    const layoutSig = JSON.stringify([S.subClusters, S.ageBasis]);
    if (restored > N * 0.5) sim.alpha(st.sig === layoutSig ? 0.12 : 0.7);
    const orphanForce: any = (alpha: number) => {
      orphans.forEach((n: any, k) => {
        const r = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0) || 1;
        const target = 190 + ((k * 37) % 90);
        const f = ((target - r) / r) * 0.12 * alpha;
        n.vx = (n.vx ?? 0) + (n.x ?? 0) * f; n.vy = (n.vy ?? 0) + (n.y ?? 0) * f; n.vz = (n.vz ?? 0) + (n.z ?? 0) * f;
      });
    };
    orphanForce.initialize = () => {};
    sim.force("orphan", orphanForce);
    // Expansion: das Älteste außen, das Frischeste im Kern
    const ageR = new Float32Array(N);
    [...nodes.keys()].sort((a, b) => ageOf(nodes[a]) - ageOf(nodes[b])).forEach((i, r) => { ageR[i] = shell(1 - r / Math.max(1, N - 1)); });
    const ageForce: any = (alpha: number) => {
      if (!expansion) return;
      nodes.forEach((n: any, i) => {
        if (isOrphan[i]) return;
        const r = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0) || 1;
        const f = ((ageR[i] - r) / r) * 0.8 * alpha;
        n.vx = (n.vx ?? 0) + (n.x ?? 0) * f; n.vy = (n.vy ?? 0) + (n.y ?? 0) * f; n.vz = (n.vz ?? 0) + (n.z ?? 0) * f;
      });
    };
    ageForce.initialize = () => {};
    sim.force("age", ageForce);
    // Unterordner als Sternhaufen: Notizen im selben Unterordner (ab Ebene 2) werden zu ihrem Schwerpunkt gezogen
    const groups = new Map<string, number[]>();
    nodes.forEach((n, i) => {
      const parts = n.path.split("/");
      if (parts.length >= 3 && !isOrphan[i]) { const key = parts.slice(0, -1).join("/"); (groups.get(key) ?? groups.set(key, []).get(key)!).push(i); }
    });
    const clusterGroups = [...groups.values()].filter((g) => g.length >= 3);
    const clusterForce: any = (alpha: number) => {
      if (!S.subClusters) return;
      clusterGroups.forEach((g) => {
        let cx = 0, cy = 0, cz = 0;
        g.forEach((i) => { cx += nodes[i].x ?? 0; cy += nodes[i].y ?? 0; cz += nodes[i].z ?? 0; });
        cx /= g.length; cy /= g.length; cz /= g.length;
        g.forEach((i) => {
          const n: any = nodes[i];
          n.vx = (n.vx ?? 0) + (cx - (n.x ?? 0)) * 0.25 * alpha; n.vy = (n.vy ?? 0) + (cy - (n.y ?? 0)) * 0.25 * alpha; n.vz = (n.vz ?? 0) + (cz - (n.z ?? 0)) * 0.25 * alpha;
        });
      });
    };
    clusterForce.initialize = () => {};
    sim.force("cluster", clusterForce);

    const linkS = links.map((l) => idx.get((l.source as GNode).id)!);
    const linkT = links.map((l) => idx.get((l.target as GNode).id)!);
    const linkKey = links.map((_, k) => Math.min(linkS[k], linkT[k]) * N + Math.max(linkS[k], linkT[k]));
    const neighbors = nodes.map(() => new Set<number>());
    links.forEach((_, k) => { neighbors[linkS[k]].add(linkT[k]); neighbors[linkT[k]].add(linkS[k]); });

    // ---- Labels (HTML-Overlay) ----
    const labelLayer = root.createDiv({ cls: "n3d-labels" });
    const labels = nodes.map((n) => labelLayer.createDiv({ cls: "n3d-label", text: n.name }));
    const conLabel = labelLayer.createDiv({ cls: "n3d-folder" });
    const ringLblOld = labelLayer.createDiv({ cls: "n3d-ringlbl", text: t("ringOld") });
    const ringLblNew = labelLayer.createDiv({ cls: "n3d-ringlbl", text: t("ringNew") });

    // Nebel pro Ordner
    const glowTex = glowTexture();
    const nebulae = folders.map((f) => {
      const members = nodes.map((n, i) => (n.folder === f && !isOrphan[i] ? i : -1)).filter((i) => i >= 0);
      if (members.length < 3) return null;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: colorOf(f), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(sprite);
      const label = labelLayer.createDiv({ cls: "n3d-folder", text: f });
      return { folder: f, members, sprite, label };
    });
    const hubs = new Set([...nodes].sort((a, b) => b.deg - a.deg).slice(0, 8).map((n) => n.id));

    // Fokus-Halo, Ripples
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.visible = false; scene.add(halo);
    const ringTex = rippleTexture();
    const ripples: { sprite: THREE.Sprite; t0: number }[] = [];
    const rippleAt = (pos: THREE.Vector3, color: THREE.Color, nowT: number) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.position.copy(pos); scene.add(sprite);
      ripples.push({ sprite, t0: nowT });
    };

    // Kometen
    const TR = 6;
    const cometN = links.length ? Math.min(Math.round(S.cometCount * (S.performance ? 0.3 : 1)), links.length) : 0;
    const cLink = new Int32Array(cometN).fill(-1);
    const cP = new Float32Array(cometN), cSpd = new Float32Array(cometN), cDir = new Int8Array(cometN);
    const cPos = new Float32Array(cometN * TR * 3), cCol = new Float32Array(cometN * TR * 3);
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
    cGeo.setAttribute("color", new THREE.BufferAttribute(cCol, 3));
    const cPoints = new THREE.Points(cGeo, new THREE.PointsMaterial({ size: 2.1, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    cPoints.frustumCulled = false;
    scene.add(cPoints);
    const trail = [0, 0.016, 0.034, 0.056, 0.082, 0.112], trailB = [2.4, 1.2, 0.85, 0.55, 0.3, 0.14];

    // Sternschnuppe
    const ssGeo = new THREE.BufferGeometry();
    const ssPos = new Float32Array(6), ssCol = new Float32Array([0, 0, 0, 1.6, 1.7, 2.2]);
    ssGeo.setAttribute("position", new THREE.BufferAttribute(ssPos, 3));
    ssGeo.setAttribute("color", new THREE.BufferAttribute(ssCol, 3));
    const ssMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const ssLine = new THREE.Line(ssGeo, ssMat); ssLine.frustumCulled = false; scene.add(ssLine);
    const ss = { active: false, t: 0, dur: 0.8, head: new THREE.Vector3(), dir: new THREE.Vector3(), next: 3 };

    // ---- Zustand ----
    const selected = new Set<string>(st.selected ?? []);
    const inSel = (n: GNode) => selected.size === 0 || selected.has(n.folder);
    let focusOn = !!st.focusOn;
    let focusNode: GNode | null = null;
    let colorMode: "folder" | "age" = st.colorMode ?? "folder";
    let expansion = !!st.expansion;
    let disc = !!st.disc, discK = disc ? 1 : 0, discT = 0, ringK = 0, expK = expansion ? 1 : 0;
    // Große Vaults: Nebel dünner, damit sie nicht zu einem Farbnebel verschmelzen
    const nebK = S.denseCore ? 1 : Math.min(1, Math.pow(900 / Math.max(N, 1), 0.3));
    let tiltDeg = st.tilt ?? 60, spinSpeed = st.spinSpeed ?? 1, orbAng = 0;
    let searchHits = new Set<string>();
    let hovered: GNode | null = null;
    let dmHover = -1;
    let spot: Set<number> | null = null;
    let spotPairs: Set<number> | null = null;
    let routeMode = false, routeA = -1;
    let lastRoute: string[] | null = null, activeTag: string | null = null;
    let quality = 0, slowFrames = 0, fastFrames = 0, fpsAvg = 60, lastDowngrade = 0, lastUpgrade = -99, upDelay = 20, throttleNotified = false;
    let pendingRestore: (() => void) | null = null;
    const COMET_Q = [1, 0.5, 0.2];
    const cinema = { on: false, step: -1, wait: 0, target: -1 };
    const sortedC = nodes.map((n) => n.ctime).sort((a, b) => a - b);
    const cr = new Int32Array(N);
    [...nodes.keys()].sort((a, b) => nodes[a].ctime - nodes[b].ctime).forEach((i, j) => { cr[i] = j; });
    let timeVal = 1000, timeCut = Infinity, playing = false, timeSpeed = 1;
    const countShown = () => {
      if (!isFinite(timeCut)) return N;
      let lo = 0, hi = N;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sortedC[m] <= timeCut) lo = m + 1; else hi = m; }
      return lo;
    };
    const radR = new Float32Array(N).fill(NaN);
    const phi = new Float32Array(N);
    let shotRequested = false;

    const applyColorMode = () => {
      nodes.forEach((n, i) => baseCols[i] = colorMode === "age" ? ageColor(ageOf(n)) : colorOf(n.folder));
    };
    applyColorMode();

    const flyTo = (tp: THREE.Vector3, tt: THREE.Vector3, dur = 1.4) => {
      controls.autoRotate = false;
      fly = { t: 0, dur, fp: camera.position.clone(), ft: controls.target.clone(), tp, tt };
    };
    const flyToNode = (i: number, dur = 1.4, dist = 80) => {
      const dir = camera.position.clone().sub(P[i]);
      if (dir.lengthSq() < 1) dir.set(0, 0, 1);
      dir.normalize();
      flyTo(P[i].clone().add(dir.multiplyScalar(dist)), P[i].clone(), dur);
    };
    this.onFile = (f) => {
      focusNode = f ? byId.get(f.path) ?? null : null;
      if (focusOn && focusNode) flyToNode(idx.get(focusNode.id)!);
    };
    const af = this.app.workspace.getActiveFile();
    if (af) focusNode = byId.get(af.path) ?? null;

    // ---- Ton ----
    let soundOn = S.sound;
    let ambientTimer = 0;
    // Sanfte, generative Klangflächen: lange Ein- und Ausblendung, Hall, nichts unter 160 Hz (kein Brummen)
    const startAmbient = (ctx: AudioContext, out: GainNode) => {
      const bus = ctx.createGain();
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 160;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
      bus.connect(hp); hp.connect(lp); lp.connect(out);
      [{ time: 0.37, fbk: 0.4 }, { time: 0.61, fbk: 0.35 }].forEach((d) => {
        const dl = ctx.createDelay(2), fb = ctx.createGain(), wet = ctx.createGain();
        dl.delayTime.value = d.time; fb.gain.value = d.fbk; wet.gain.value = 0.45;
        lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(out);
      });
      const scale = [220, 261.63, 293.66, 329.63, 392];
      const note = () => {
        if (soundOn) {
          const count = Math.random() < 0.35 ? 2 : 1;
          for (let c = 0; c < count; c++) {
            const f = scale[(Math.random() * scale.length) | 0] * (Math.random() < 0.35 ? 2 : 1);
            const g = ctx.createGain(), t0 = ctx.currentTime;
            g.gain.setValueAtTime(0, t0);
            g.gain.linearRampToValueAtTime(0.05, t0 + 3.2);
            g.gain.linearRampToValueAtTime(0, t0 + 9);
            g.connect(bus);
            [{ fq: f, type: "sine" as OscillatorType, amp: 1 }, { fq: f * 1.004, type: "triangle" as OscillatorType, amp: 0.35 }].forEach((v) => {
              const o = ctx.createOscillator(), og = ctx.createGain();
              o.type = v.type; o.frequency.value = v.fq; og.gain.value = v.amp;
              o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + 9.2);
            });
          }
        }
        ambientTimer = window.setTimeout(note, 3500 + Math.random() * 4500);
      };
      note();
    };
    let audioCtx: AudioContext | null = null;
    let master: GainNode | null = null;
    const ensureAudio = () => {
      if (!soundOn) return null;
      if (!audioCtx) {
        try {
          audioCtx = new AudioContext();
          master = audioCtx.createGain(); master.gain.value = S.volume * 0.5; master.connect(audioCtx.destination);
          startAmbient(audioCtx, master);
        } catch { audioCtx = null; return null; }
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    };
    const ping = (freq: number, vol = 0.07, dur = 0.8) => {
      const ctx = ensureAudio(); if (!ctx || !master) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.05);
    };
    const nodeFreq = (i: number) => PENTATONIC[(folders.indexOf(nodes[i].folder) * 2 + (nodes[i].deg % 3)) % 5] * (nodes[i].deg > 12 ? 0.5 : 1);
    const spawnRipple = (i: number, nowT: number) => {
      rippleAt(P[i], baseCols[i].clone().lerp(new THREE.Color(0xffffff), 0.4), nowT);
      flash[i] = nowT;
      ping(nodeFreq(i) * 2, 0.09, 1.1);
    };

    // ---- UI ----
    const legend = root.createDiv({ cls: "n3d-legend" });
    const rows = new Map<string, HTMLElement>();
    const dots = new Map<string, HTMLElement>();
    const allRow = legend.createDiv({ cls: "n3d-row n3d-all", text: t("showAll") });
    const resetRow = legend.createDiv({ cls: "n3d-row n3d-all", text: t("resetColors") });
    const ageBar = legend.createDiv({ cls: "n3d-agebar" });
    ageBar.createDiv({ cls: "bar" });
    ageBar.createDiv({ cls: "lbl", text: t("ageLegend") });
    const refreshLegend = () => {
      allRow.style.display = selected.size ? "" : "none";
      resetRow.style.display = Object.keys(custom).length ? "" : "none";
      rows.forEach((el, f) => el.toggleClass("off", selected.size > 0 && !selected.has(f)));
      ageBar.style.display = colorMode === "age" ? "" : "none";
      dots.forEach((d, f) => {
        const c = colorMode === "age" ? "#6b7399" : "#" + colorOf(f).getHexString();
        d.style.background = c; d.style.boxShadow = `0 0 6px ${c}`;
      });
    };
    allRow.onclick = () => { selected.clear(); refreshLegend(); };
    const recolor = () => {
      applyColorMode(); refreshLegend();
      nebulae.forEach((nb) => { if (nb) (nb.sprite.material as THREE.SpriteMaterial).color.copy(colorOf(nb.folder)); });
      disks.forEach((d) => d.mat.color.copy(colorOf(d.n.folder)).lerp(new THREE.Color(0xffffff), 0.45));
    };
    resetRow.onclick = () => { Object.keys(custom).forEach((k) => delete custom[k]); recolor(); };
    folders.forEach((f) => {
      const row = legend.createDiv({ cls: "n3d-row" });
      row.title = t("legendTip");
      rows.set(f, row);
      row.onclick = () => { selected.has(f) ? selected.delete(f) : selected.add(f); refreshLegend(); };
      const dot = row.createSpan({ cls: "dot" });
      dot.title = t("colorTip");
      dots.set(f, dot);
      const pick = row.createEl("input", { type: "color", cls: "n3d-pick" });
      pick.onclick = (e) => e.stopPropagation();
      pick.oninput = () => { custom[f] = pick.value; recolor(); };
      dot.onclick = (e) => {
        e.stopPropagation();
        if (colorMode === "age") { new Notice(t("ageNotice")); return; }
        pick.value = "#" + colorOf(f).getHexString();
        pick.click();
      };
      row.appendText(f);
    });
    refreshLegend();
    const hint = legend.createDiv({ text: t("pulseHint", S.pulseDays) });
    hint.style.cssText = "margin-top:6px;opacity:.7";

    const ui = root.createDiv({ cls: "n3d-ui" });
    const mkBtn = (text: string, fn: () => void) => { const b = ui.createEl("button", { text }); b.onclick = fn; return b; };
    const rotBtn = mkBtn(t("rotation"), () => { controls.autoRotate = !controls.autoRotate; controls.autoRotateSpeed = baseRot; });
    rotBtn.title = t("rotationTip");
    rotBtn.style.display = disc ? "none" : "";
    const focusBtn = mkBtn(t("focus"), () => {
      focusOn = !focusOn; focusBtn.toggleClass("active", focusOn);
      if (focusOn && !focusNode) { const a = this.app.workspace.getActiveFile(); if (a) focusNode = byId.get(a.path) ?? null; }
      if (focusOn && focusNode) flyToNode(idx.get(focusNode.id)!);
    });
    focusBtn.toggleClass("active", focusOn);
    const colorBtn = mkBtn(colorMode === "age" ? t("colorAge") : t("colorFolder"), () => {
      colorMode = colorMode === "age" ? "folder" : "age";
      colorBtn.setText(colorMode === "age" ? t("colorAge") : t("colorFolder"));
      applyColorMode(); refreshLegend();
    });
    const expBtn = mkBtn(t("expansion"), () => {
      expansion = !expansion; expBtn.toggleClass("active", expansion);
      sim.alpha(1).restart();
    });
    expBtn.toggleClass("active", expansion);
    const discBtn = mkBtn(t("spiral"), () => {
      disc = !disc; discBtn.toggleClass("active", disc);
      flyTo(new THREE.Vector3(0, 0, 320), new THREE.Vector3(0, 0, 0), 2.2);
      spiralPanel.style.display = disc ? "flex" : "none";
      rotBtn.style.display = disc ? "none" : "";
    });
    discBtn.toggleClass("active", disc);
    const routeBtn = mkBtn(t("route"), () => {
      if (routeMode || spot) { clearSpot(); return; }
      routeMode = true; routeA = -1; routeBtn.addClass("active");
      new Notice(t("routeStart"));
    });
    mkBtn(t("cinema"), () => startCinema()).title = t("cinemaTip");
    mkBtn(t("photo"), () => { shotRequested = true; }).title = t("photoTip");
    const videoBtn = mkBtn(t("video"), () => { if (rec) stopRec(); else startRec(false); });
    const soundBtn = mkBtn(t("sound"), () => {
      soundOn = !soundOn; soundBtn.toggleClass("active", soundOn);
      if (soundOn) ensureAudio();
      if (master && audioCtx) master.gain.setTargetAtTime(soundOn ? S.volume * 0.5 : 0, audioCtx.currentTime, 0.2);
    });
    soundBtn.toggleClass("active", soundOn);
    mkBtn(t("reorder"), () => sim.alpha(1).restart()).title = t("reorderTip");
    mkBtn(t("reset"), () => flyTo(new THREE.Vector3(0, 0, 320), new THREE.Vector3(0, 0, 0))).title = t("resetTip");
    const statsEl = root.createDiv({ cls: "n3d-stats" });
    statsEl.style.display = S.showStats ? "" : "none";
    let fpsEma = 60;
    const help = root.createDiv({ cls: "n3d-help" });
    help.style.display = "none";
    help.createDiv({ cls: "h", text: t("helpTitle") });
    for (let k = 1; k <= 11; k++) {
      const [key, desc] = t("help" + k).split("|");
      const r = help.createDiv({ cls: "r" });
      r.createSpan({ cls: "k", text: key }); r.createSpan({ cls: "d", text: desc });
    }
    help.onclick = () => { help.style.display = "none"; };
    mkBtn("?", () => { help.style.display = help.style.display === "none" ? "" : "none"; }).title = t("helpTip");
    focusBtn.title = t("focusTip");
    colorBtn.title = t("colorTipBtn");
    expBtn.title = t("expansionTip");
    discBtn.title = t("spiralTip");
    routeBtn.title = t("routeTip");
    videoBtn.title = t("videoTip");
    soundBtn.title = t("soundTip");
    mkBtn("⚙", () => {
      const setting = (this.app as any).setting;
      setting?.open?.();
      setting?.openTabById?.(this.plugin.manifest.id);
    }).title = t("settings");
    const spiralPanel = ui.createDiv({ cls: "n3d-spiralpanel" });
    spiralPanel.style.display = disc ? "flex" : "none";
    const mkSlider = (label: string, min: number, max: number, step: number, val: number, unit: string, onInput: (v: number) => void) => {
      const wrap = spiralPanel.createDiv({ cls: "n3d-sl" });
      wrap.createSpan({ text: label });
      const input = wrap.createEl("input", { type: "range" });
      input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(val);
      const out = wrap.createSpan({ cls: "v", text: val + unit });
      input.oninput = () => { onInput(+input.value); out.setText(input.value + unit); };
    };
    mkSlider(t("tilt"), 0, 90, 1, tiltDeg, "°", (v) => { tiltDeg = v; });
    mkSlider(t("spinSpeed"), 0, 3, 0.1, spinSpeed, "×", (v) => { spinSpeed = v; });

    // Suche
    const search = root.createDiv({ cls: "n3d-search" });
    const sIn = search.createEl("input", { type: "text", placeholder: t("search") });
    sIn.title = t("searchTip");
    const chip = search.createDiv({ cls: "n3d-chip" });
    chip.style.display = "none";
    const sList = search.createDiv({ cls: "n3d-results" });
    const goTo = (n: GNode) => { const i = idx.get(n.id)!; flyToNode(i); spawnRipple(i, performance.now() / 1000); };

    const clearSpot = () => {
      spot = null; spotPairs = null; routeMode = false; routeA = -1; conEdges = []; lastRoute = null; activeTag = null;
      conGeo.setDrawRange(0, 0); conLabel.removeClass("on"); chip.style.display = "none"; tourQ.length = 0;
      routeBtn.removeClass("active");
    };
    chip.onclick = clearSpot;
    const showChip = (text: string) => { chip.setText("✦ " + text + "  ×"); chip.style.display = ""; };

    const shortest = (a: number, b: number): number[] | null => {
      const prev = new Int32Array(N).fill(-2); prev[a] = -1;
      const q = [a];
      for (let qi = 0; qi < q.length; qi++) {
        const u = q[qi]; if (u === b) break;
        neighbors[u].forEach((v) => { if (prev[v] === -2) { prev[v] = u; q.push(v); } });
      }
      if (prev[b] === -2) return null;
      const path: number[] = [];
      for (let c = b; c !== -1; c = prev[c]) path.push(c);
      return path.reverse();
    };
    const setRoute = (path: number[], tour = true) => {
      clearSpot();
      spot = new Set(path);
      spotPairs = new Set();
      for (let k = 0; k + 1 < path.length; k++) spotPairs.add(Math.min(path[k], path[k + 1]) * N + Math.max(path[k], path[k + 1]));
      showChip(t("routeChip", path.length - 1));
      if (tour) tourQ.push(...path);
      lastRoute = [nodes[path[0]].id, nodes[path[path.length - 1]].id];
    };
    const setTag = (tag: string, fly = true) => {
      const members = tagIndex.get(tag);
      if (!members || !members.size) return;
      clearSpot();
      activeTag = tag;
      spot = new Set(members);
      const list = [...members];
      const inTree = new Set<number>([list[0]]);
      while (inTree.size < list.length) {
        let best = Infinity, ba = -1, bb = -1;
        inTree.forEach((a) => list.forEach((b) => {
          if (inTree.has(b)) return;
          const d = P[a].distanceToSquared(P[b]);
          if (d < best) { best = d; ba = a; bb = b; }
        }));
        inTree.add(bb); conEdges.push([ba, bb]);
      }
      const c = new THREE.Vector3();
      list.forEach((i) => c.add(P[i])); c.divideScalar(list.length);
      let r = 0; list.forEach((i) => { r = Math.max(r, P[i].distanceTo(c)); });
      conLabel.setText(tag); conLabel.dataset.cx = c.x + "," + c.y + "," + c.z;
      showChip(`${tag} · ${list.length}`);
      const dir = camera.position.clone().sub(c).normalize();
      if (fly) flyTo(c.clone().add(dir.multiplyScalar(r * 2.1 + 60)), c.clone());
    };

    const doSearch = () => {
      const q = sIn.value.trim().toLowerCase();
      sList.empty(); searchHits = new Set();
      if (!q) return;
      if (q.startsWith("#")) {
        [...tagIndex.entries()].filter(([tg]) => tg.toLowerCase().includes(q)).sort((a, b) => b[1].size - a[1].size).slice(0, 8).forEach(([tg, set]) => {
          const it = sList.createDiv({ cls: "n3d-result", text: `${tg} · ${set.size}` });
          it.onclick = () => { setTag(tg); sIn.value = ""; sList.empty(); };
        });
        return;
      }
      const hits = nodes.filter((n) => n.name.toLowerCase().includes(q));
      hits.slice(0, 80).forEach((n) => searchHits.add(n.id));
      hits.slice(0, 8).forEach((n) => {
        const it = sList.createDiv({ cls: "n3d-result", text: n.name });
        const dot = it.createSpan({ cls: "dot" }); dot.style.background = "#" + colorOf(n.folder).getHexString();
        it.prepend(dot);
        it.onclick = () => goTo(n);
      });
    };
    sIn.oninput = doSearch;
    sIn.onkeydown = (e) => {
      e.stopPropagation();
      const q = sIn.value.trim().toLowerCase();
      if (e.key === "Enter" && q) {
        if (q.startsWith("#")) { const tg = [...tagIndex.keys()].find((x) => x.toLowerCase().includes(q)); if (tg) { setTag(tg); sIn.value = ""; sList.empty(); } }
        else { const n = nodes.find((x) => x.name.toLowerCase().includes(q)); if (n) goTo(n); }
      }
      if (e.key === "Escape") { sIn.value = ""; doSearch(); }
    };

    // Zeitreise
    const tl = root.createDiv({ cls: "n3d-time" });
    const playBtn = tl.createEl("button", { text: "▶" });
    const speedBtn = tl.createEl("button", { text: "1×" });
    const SPEEDS = [0.25, 0.5, 1, 2, 4];
    speedBtn.onclick = () => {
      timeSpeed = SPEEDS[(SPEEDS.indexOf(timeSpeed) + 1) % SPEEDS.length];
      speedBtn.setText(timeSpeed + "×");
    };
    const recTlBtn = tl.createEl("button", { text: "⏺" });
    recTlBtn.title = t("timelapse");
    playBtn.title = t("playTip");
    speedBtn.title = t("speedTip");
    const slider = tl.createEl("input", { type: "range" });
    slider.min = "0"; slider.max = "1000"; slider.value = "1000";
    slider.title = t("sliderTip");
    const tLabel = tl.createSpan({ cls: "n3d-tlabel", text: t("today") + " · " + N });
    const setTime = (v: number) => {
      timeVal = v;
      if (v >= 1000) { timeCut = Infinity; tLabel.setText(t("today") + " · " + sortedC.length); return; }
      const k = Math.max(1, Math.floor((v / 1000) * sortedC.length));
      timeCut = sortedC[k - 1];
      tLabel.setText(new Date(timeCut).toLocaleDateString(dateLoc, { day: "numeric", month: "short", year: "numeric" }) + " · " + k);
    };
    slider.oninput = () => { playing = false; playBtn.setText("▶"); setTime(+slider.value); };
    playBtn.onclick = () => {
      if (playing) { playing = false; playBtn.setText("▶"); return; }
      if (timeVal >= 1000) { setTime(0); slider.value = "0"; }
      playing = true; playBtn.setText("❚❚");
    };

    // Video-Aufnahme
    let rec: MediaRecorder | null = null;
    let recChunks: Blob[] = [];
    let recAuto = false;
    const startRec = (auto: boolean) => {
      if (rec) return;
      if (typeof MediaRecorder === "undefined" || !renderer.domElement.captureStream) { new Notice(t("videoUnsupported")); return; }
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
      try {
        rec = new MediaRecorder(renderer.domElement.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      } catch { new Notice(t("videoUnsupported")); return; }
      recChunks = []; recAuto = auto;
      rec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
      rec.onstop = () => {
        saveBlob(new Blob(recChunks, { type: "video/webm" }), `galaxie-${stamp()}.webm`);
        new Notice(t("videoSaved"));
        rec = null; videoBtn.removeClass("active"); recTlBtn.removeClass("active");
      };
      rec.start(250);
      videoBtn.addClass("active"); if (auto) recTlBtn.addClass("active");
      if (!auto) new Notice(t("videoStart"));
    };
    const stopRec = () => { if (rec && rec.state !== "inactive") rec.stop(); };
    recTlBtn.onclick = () => {
      if (rec) { stopRec(); return; }
      startRec(true);
      if (!rec) return;
      setTime(0); slider.value = "0"; playing = true; playBtn.setText("❚❚");
    };

    // Minimap
    const mini = root.createEl("canvas", { cls: "n3d-mini" });
    mini.width = 300; mini.height = 300;
    mini.title = t("miniTip");
    const mg = mini.getContext("2d")!;
    let mScale = 1;
    let miniYaw = st.mini?.[0] ?? 0, miniPitch = st.mini?.[1] ?? 0;
    // Drehung der Karte (Gieren um Y, dann Kippen um X) und ihre Umkehrung
    const mr = (x: number, y: number, z: number): [number, number, number] => {
      const cy = Math.cos(miniYaw), sy = Math.sin(miniYaw), cp = Math.cos(miniPitch), sp = Math.sin(miniPitch);
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
    };
    const mrInv = (x: number, y: number, z: number): [number, number, number] => {
      const cy = Math.cos(miniYaw), sy = Math.sin(miniYaw), cp = Math.cos(miniPitch), sp = Math.sin(miniPitch);
      const y1 = y * cp + z * sp, z1 = -y * sp + z * cp;
      return [x * cy - z1 * sy, y1, x * sy + z1 * cy];
    };
    let miniDrag: { x: number; y: number; moved: boolean } | null = null;
    mini.onpointerdown = (e) => { miniDrag = { x: e.clientX, y: e.clientY, moved: false }; mini.setPointerCapture(e.pointerId); };
    mini.onpointermove = (e) => {
      if (!miniDrag) return;
      const dx = e.clientX - miniDrag.x, dy = e.clientY - miniDrag.y;
      if (!miniDrag.moved && Math.hypot(dx, dy) < 4) return;
      miniDrag.moved = true;
      miniYaw += dx * 0.012; miniPitch = Math.max(-1.5, Math.min(1.5, miniPitch + dy * 0.012));
      miniDrag.x = e.clientX; miniDrag.y = e.clientY;
    };
    mini.onpointerup = (e) => {
      const d = miniDrag; miniDrag = null;
      if (!d || d.moved) return;
      // Klick: Kamera dorthin verschieben (Tiefe bleibt die des aktuellen Ziels)
      const r = mini.getBoundingClientRect();
      const sx = (((e.clientX - r.left) / r.width) * 300 - 150) / mScale;
      const sy = -(((e.clientY - r.top) / r.height) * 300 - 150) / mScale;
      const depth = mr(controls.target.x, controls.target.y, controls.target.z)[2];
      const w3 = mrInv(sx, sy, depth);
      const tt = new THREE.Vector3(w3[0], w3[1], w3[2]);
      flyTo(camera.position.clone().add(tt.clone().sub(controls.target)), tt);
    };
    mini.ondblclick = () => { miniYaw = 0; miniPitch = 0; };

    // Hover-Karte
    const card = root.createDiv({ cls: "n3d-card" });
    const cardCache = new Map<string, string>();
    let cardKey = "", hoverSince = 0, mx = 0, my = 0;
    const fillCard = (n: GNode) => {
      const i = idx.get(n.id)!;
      card.empty();
      card.createDiv({ cls: "t", text: n.name });
      card.createDiv({ cls: "m", text: t("cardMeta", n.folder, n.deg, new Date(n.mtime).toLocaleDateString(dateLoc)) });
      const extra: string[] = [];
      if (taskCount[i]) extra.push("☐ " + t("cardTasks", taskCount[i]));
      if (planetCount[i]) extra.push("◎ " + t("cardAttach", planetCount[i]));
      if (extra.length) card.createDiv({ cls: "m", text: extra.join("   ") });
      if (tagsOf[i].length) card.createDiv({ cls: "g", text: tagsOf[i].slice(0, 6).join("  ") });
      const body = card.createDiv({ cls: "b", text: cardCache.get(n.id) ?? "…" });
      if (!cardCache.has(n.id)) {
        const f = this.app.vault.getAbstractFileByPath(n.path);
        if (f instanceof TFile) this.app.vault.cachedRead(f).then((txt) => {
          const clean = txt.replace(/^---[\s\S]*?---\s*/, "").replace(/[#>*_`]|\[\[|\]\]|\!\[/g, "").replace(/\s+/g, " ").trim().slice(0, 190);
          cardCache.set(n.id, clean || t("cardEmpty"));
          if (cardKey === "n:" + n.id) body.setText(clean || t("cardEmpty"));
        });
      }
    };
    const fillDmCard = (k: number) => {
      card.empty();
      card.createDiv({ cls: "t", text: dms[k].name });
      card.createDiv({ cls: "g", text: "✦ " + t("dmTitle") });
      card.createDiv({ cls: "b", text: t("dmInfo", dms[k].srcs.length) });
    };

    // Kino
    const cineLabel = root.createDiv({ cls: "n3d-cine" });
    const cineHint = root.createDiv({ cls: "n3d-cinehint", text: t("cineHint") });
    const cineWaypoints = [...nodes.keys()].sort((a, b) => nodes[b].deg - nodes[a].deg).slice(0, 8);
    const startCinema = () => {
      if (!N) return;
      clearSpot();
      cinema.on = true; cinema.step = -1; cinema.wait = 0; cinema.target = -1;
      root.addClass("n3d-cinema");
      cineHint.removeClass("show"); void cineHint.offsetWidth; cineHint.addClass("show");
    };
    const exitCinema = () => {
      cinema.on = false; cinema.target = -1; cineLabel.setText(""); cineLabel.removeClass("on");
      root.removeClass("n3d-cinema"); controls.autoRotate = false; controls.autoRotateSpeed = baseRot;
    };

    // ---- Interaktion ----
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const dom = renderer.domElement;
    const onMove = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      mx = e.clientX - r.left; my = e.clientY - r.top;
    };
    let downAt = [0, 0];
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
      controls.autoRotate = false; fly = null; tourQ.length = 0;
      ensureAudio();
      if (cinema.on) exitCinema();
    };
    let noteLeaf: WorkspaceLeaf | null = null;
    const openBeside = async (path: string, newTab: boolean) => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return;
      if (newTab) { await this.app.workspace.getLeaf("tab").openFile(f); return; }
      let alive = false;
      if (noteLeaf) this.app.workspace.iterateAllLeaves((l) => { if (l === noteLeaf) alive = true; });
      if (!alive) noteLeaf = this.app.workspace.getLeaf("split", "vertical");
      await noteLeaf!.openFile(f, { active: false });
    };
    const createFromDarkMatter = async (k: number) => {
      const d = dms[k];
      const first = nodes[d.srcs[0]];
      const parent = d.name.includes("/") ? "" : this.app.fileManager.getNewFileParent(first.path).path;
      const base = d.name.toLowerCase().endsWith(".md") ? d.name : d.name + ".md";
      const path = normalizePath((parent && parent !== "/" ? parent + "/" : "") + base);
      try {
        const slash = path.lastIndexOf("/");
        if (slash > 0 && !this.app.vault.getAbstractFileByPath(path.slice(0, slash))) await this.app.vault.createFolder(path.slice(0, slash));
        const file = await this.app.vault.create(path, "");
        new Notice(t("dmCreated", d.name));
        ping(PENTATONIC[0] * 2, 0.1, 1.4);
        rippleAt(dmP[k], DM_COL.clone().lerp(new THREE.Color(0xffffff), 0.4), performance.now() / 1000);
        openBeside(file.path, false);
      } catch { new Notice(t("dmFail", d.name)); }
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
      if (!hovered && dmHover >= 0 && !routeMode) { createFromDarkMatter(dmHover); return; }
      if (!hovered) return;
      const i = idx.get(hovered.id)!;
      spawnRipple(i, performance.now() / 1000);
      if (routeMode) {
        if (routeA < 0) { routeA = i; new Notice(t("routeFrom", hovered.name)); return; }
        const path = i === routeA ? null : shortest(routeA, i);
        routeMode = false; routeBtn.removeClass("active");
        if (!path) new Notice(t("routeNone")); else setRoute(path);
        routeA = -1;
        return;
      }
      focusNode = hovered;
      if (focusOn) flyToNode(i);
      openBeside(hovered.path, e.ctrlKey || e.metaKey);
    };
    const onDbl = () => { if (hovered && !routeMode) flyToNode(idx.get(hovered.id)!); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || root.clientWidth === 0) return;
      if (help.style.display !== "none") help.style.display = "none";
      else if (cinema.on) exitCinema(); else if (spot || routeMode) clearSpot();
    };
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("dblclick", onDbl);
    window.addEventListener("keydown", onKey);

    // ---- Live-Updates ----
    this.live = {
      modify: (path) => {
        const i = idx.get(path); if (i === undefined) return;
        const nowT = performance.now() / 1000;
        if (nowT - lastPulse[i] < 3) return;
        lastPulse[i] = nowT; recent[i] = true; nodes[i].mtime = Date.now();
        if (colorMode === "age") baseCols[i] = ageColor(ageOf(nodes[i]));
        spawnRipple(i, nowT);
      },
      structural: () => this.scheduleRebuild(),
      resolved: () => { const s2 = sigOf(); if (s2 !== linkSig) { linkSig = s2; this.scheduleRebuild(); } },
    };

    // ---- Gedächtnis ----
    const saveState = () => {
      const pos: Record<string, number[]> = {};
      nodes.forEach((n) => { pos[n.id] = [Math.round((n.x ?? 0) * 100) / 100, Math.round((n.y ?? 0) * 100) / 100, Math.round((n.z ?? 0) * 100) / 100]; });
      this.state = {
        cam: camera.position.toArray(), target: controls.target.toArray(),
        selected: [...selected], focusOn, colorMode, expansion, disc, colors: custom, tilt: tiltDeg, spinSpeed, pos,
        query: sIn.value, route: lastRoute ?? undefined, tag: activeTag ?? undefined, sig: layoutSig, mini: [miniYaw, miniPitch],
      };
      try { window.localStorage.setItem(this.storeKey(), JSON.stringify(this.state)); } catch { /* egal */ }
    };
    const saveTimer = window.setInterval(saveState, 5000);

    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
    const linkOn = new Uint8Array(links.length);
    const activeLinks: number[] = [];
    let lastT = performance.now() / 1000;
    let frameNo = 0;
    let mExt = 100;

    const takePhoto = () => {
      const src = renderer.domElement;
      const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
      const g = c.getContext("2d")!;
      const grd = g.createRadialGradient(c.width * 0.5, c.height * 0.4, 0, c.width * 0.5, c.height * 0.4, Math.max(c.width, c.height) * 0.75);
      grd.addColorStop(0, "#12162b"); grd.addColorStop(1, "#05060d");
      g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0);
      c.toBlob((b) => { if (!b) return; saveBlob(b, `galaxie-${stamp()}.png`); new Notice(t("photoSaved")); }, "image/png");
    };

    const downgrade = (nowT: number) => {
      quality++; lastDowngrade = nowT;
      // Wenn es kurz nach einer Rückschaltung wieder zu langsam wird, länger warten, bevor die Effekte erneut hochgeschaltet werden
      if (nowT - lastUpgrade < 60) upDelay = Math.min(300, upDelay * 2);
      if (quality === 1) { composer.setPixelRatio(1); renderer.setPixelRatio(1); renderer.setSize(w(), h()); composer.setSize(w(), h()); }
      if (quality === 2) { lensPass.enabled = false; orbPoints.visible = false; }
      const live = Math.round(cometN * COMET_Q[Math.min(quality, 2)]);
      for (let c = live; c < cometN; c++) { cLink[c] = -1; for (let j = 0; j < TR * 3; j++) cCol[c * TR * 3 + j] = 0; }
      if (!throttleNotified) { throttleNotified = true; new Notice(t("throttle")); }
    };
    // Bleibt die Bildrate lange hoch (z. B. nach einer kurzen Last durch Aufnahme oder andere Programme), kommen die Effekte stufenweise zurück
    const upgrade = (nowT: number) => {
      quality--; lastDowngrade = nowT; lastUpgrade = nowT; fpsAvg = 45;
      if (quality === 1) { lensPass.enabled = S.lens && !S.performance && holeNodes.length > 0; orbPoints.visible = true; }
      if (quality === 0) { const pr = Math.min(window.devicePixelRatio, 2); composer.setPixelRatio(pr); renderer.setPixelRatio(pr); renderer.setSize(w(), h()); composer.setSize(w(), h()); }
    };

    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      if (!root.isConnected || root.clientWidth === 0) return;
      const nowT = performance.now() / 1000;
      const rawDt = nowT - lastT;
      const dt = Math.min(0.05, rawDt); lastT = nowT; frameNo++;
      if (rawDt > 0 && rawDt < 0.25) fpsEma += (1 / rawDt - fpsEma) * 0.05;
      if (S.showStats && frameNo % 20 === 0) statsEl.setText(`${Math.round(fpsEma)} fps · ${N} notes · ${links.length} links · effects ${quality === 0 ? "full" : quality === 1 ? "reduced" : "minimal"} · ${renderer.info.render.calls} draw calls`);
      if (S.autoThrottle && !S.performance && frameNo > 180 && rawDt > 0 && rawDt < 0.25 && !rec) {
        fpsAvg += (1 / rawDt - fpsAvg) * 0.04;
        slowFrames = fpsAvg < 38 ? slowFrames + 1 : 0;
        fastFrames = fpsAvg > 56 ? fastFrames + 1 : 0;
        if (quality < 2 && slowFrames > 150 && nowT - lastDowngrade > 6) { slowFrames = 0; downgrade(nowT); }
        else if (quality > 0 && fastFrames > 600 && nowT - lastDowngrade > upDelay) { fastFrames = 0; upgrade(nowT); }
      }

      // Kamera-Flug, Route-Tour, Kino
      if (fly) {
        fly.t += dt;
        const k = ease(Math.min(1, fly.t / fly.dur));
        camera.position.lerpVectors(fly.fp, fly.tp, k);
        controls.target.lerpVectors(fly.ft, fly.tt, k);
        if (fly.t >= fly.dur) fly = null;
      }
      if (!fly && tourQ.length && !cinema.on) flyToNode(tourQ.shift()!, 1.1, 70);
      if (cinema.on && !fly) {
        controls.autoRotate = true; controls.autoRotateSpeed = baseRot * 3.1;
        if (cinema.wait > 0) cinema.wait -= dt;
        else {
          cinema.step = (cinema.step + 1) % (cineWaypoints.length + 1);
          if (cinema.step === cineWaypoints.length) {
            cinema.target = -1; cineLabel.removeClass("on");
            flyTo(new THREE.Vector3(0, 0, 330), new THREE.Vector3(0, 0, 0), 6);
          } else {
            const i = cineWaypoints[cinema.step]; cinema.target = i;
            const dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.35, 0.35), rnd(-1, 1)).normalize();
            flyTo(P[i].clone().addScaledVector(dir, 120), P[i].clone(), 6.5);
            cineLabel.setText(nodes[i].name); cineLabel.addClass("on");
          }
          cinema.wait = 2.8;
        }
      }
      controls.update();

      // Zeitreise
      if (playing) {
        timeVal += ((dt * 1000) / S.timeSeconds) * timeSpeed;
        if (timeVal >= 1000) {
          timeVal = 1000; playing = false; playBtn.setText("▶");
          if (recAuto) window.setTimeout(stopRec, 1500);
        }
        slider.value = String(timeVal); setTime(timeVal);
      }

      // Render-Positionen
      orbAng += dt * 0.03 * spinSpeed;
      const ca = Math.cos(orbAng), sa = Math.sin(orbAng);
      discK += ((disc ? 1 : 0) - discK) * Math.min(1, dt * 1.6);
      ringK += (((expansion && S.rings) ? 1 : 0) - ringK) * Math.min(1, dt * 2);
      expK += ((expansion ? 1 : 0) - expK) * Math.min(1, dt * 2);
      const nodeK = S.denseCore ? 1 : 1 - expK * 0.45 * (1 - Math.min(1, 900 / Math.max(N, 1)));
      const timeExp = expansion && isFinite(timeCut);
      const kk = timeExp ? countShown() : N;
      nodes.forEach((n, i) => {
        const x = n.x ?? 0, y = n.y ?? 0, z = n.z ?? 0;
        if (isOrphan[i]) P[i].set(x * ca - z * sa, y, x * sa + z * ca);
        else {
          const r0 = Math.hypot(x, y, z) || 1;
          const tgt = timeExp ? (cr[i] < kk ? shell((kk - 1 - cr[i]) / Math.max(1, N - 1)) : shell(0)) : r0;
          radR[i] = Number.isNaN(radR[i]) ? r0 : radR[i] + (tgt - radR[i]) * Math.min(1, dt * 3);
          const sc = radR[i] / r0;
          P[i].set(x * sc, y * sc, z * sc);
        }
        if (discK > 0.001) {
          const p = P[i];
          p.y *= 1 - 0.93 * discK;
          // Jeder Stern sammelt seinen eigenen Drehwinkel (innen schneller). So drehen wandernde Sterne nicht rückwärts.
          phi[i] += (dt * discK * spin * spinSpeed) / (1 + Math.hypot(p.x, p.z) / 40);
          const a = phi[i] * discK;
          const c = Math.cos(a), s2 = Math.sin(a);
          const nx = p.x * c - p.z * s2, nz = p.x * s2 + p.z * c;
          p.x = nx; p.z = nz;
          const tph = ((tiltDeg * Math.PI) / 180) * discK, ct = Math.cos(tph), st2 = Math.sin(tph);
          const ny = p.y * ct - p.z * st2, nz2 = p.y * st2 + p.z * ct;
          p.y = ny; p.z = nz2;
        }
      });
      if (births.length) { births.forEach((i) => spawnRipple(i, nowT)); births.length = 0; }
      if (ghosts.length) { ghosts.forEach((p) => rippleAt(p, new THREE.Color(0xff9a7a), nowT)); ghosts.length = 0; }
      if (pendingRestore) { const run = pendingRestore; pendingRestore = null; run(); }

      // Hover (Sterne, dann Dunkle Materie)
      ray.setFromCamera(mouse, camera);
      const hit = cinema.on ? undefined : ray.intersectObjects(meshes, false).find((h) => { const n = h.object.userData.node as GNode; return inSel(n) && appear[idx.get(n.id)!] > 0.5; });
      hovered = hit ? (hit.object.userData.node as GNode) : null;
      const W = w(), H = h();
      dmHover = -1;
      if (!hovered && !cinema.on && dmCount) {
        let best = 13;
        for (let k = 0; k < dmCount; k++) {
          tmp.copy(dmP[k]).project(camera);
          if (tmp.z > 1) continue;
          const d = Math.hypot((tmp.x * 0.5 + 0.5) * W - mx, (-tmp.y * 0.5 + 0.5) * H - my);
          if (d < best && dms[k].srcs.some((s) => appear[s] > 0.5 && inSel(nodes[s]))) { best = d; dmHover = k; }
        }
      }
      dom.style.cursor = routeMode ? "crosshair" : hovered || dmHover >= 0 ? "pointer" : "grab";
      const anchor: GNode | null = cinema.on ? (cinema.target >= 0 ? nodes[cinema.target] : null) : hovered ?? (focusOn ? focusNode : null);
      const ai = anchor ? idx.get(anchor.id)! : -1;
      const an = anchor ? neighbors[ai] : null;
      const actOf = (i: number) => inSel(nodes[i]) && (spot ? spot.has(i) || i === ai : ai < 0 || i === ai || an!.has(i));

      // Hover-Karte und Hover-Ton
      const key = hovered ? "n:" + hovered.id : dmHover >= 0 ? "d:" + dmHover : "";
      if (key !== cardKey) {
        cardKey = key; hoverSince = nowT; card.removeClass("on");
        if (hovered) ping(nodeFreq(idx.get(hovered.id)!), 0.035, 0.5);
      }
      if (cardKey && nowT - hoverSince > 0.35) {
        if (!card.hasClass("on")) { if (hovered) fillCard(hovered); else fillDmCard(dmHover); card.addClass("on"); }
        card.style.left = Math.min(mx + 18, W - 270) + "px";
        card.style.top = Math.min(my + 18, H - 140) + "px";
      }

      // Knoten
      nodes.forEach((n, i) => {
        const m = meshes[i];
        const shown = n.ctime <= timeCut;
        appear[i] += ((shown ? 1 : 0) - appear[i]) * Math.min(1, dt * 6);
        m.visible = appear[i] > 0.02;
        if (!m.visible) return;
        m.position.copy(P[i]);
        let br = (actOf(i) ? (i === ai ? 1.8 : spot ? 1.3 : 0.9) : 0.12) * nodeK;
        let sc = m.userData.base * appear[i];
        if (recent[i]) {
          const ph = Math.sin(nowT * 2.2 + i);
          br *= 1 + 0.35 * ph; sc *= 1 + 0.22 * ph;
        }
        if ((focusOn && n === focusNode) || i === cinema.target) sc *= 1.6;
        if (flash[i]) {
          const a = (nowT - flash[i]) / 1.2;
          if (a < 1) { br += 3 * (1 - a) * (1 - a); sc *= 1 + 0.8 * (1 - a); } else flash[i] = 0;
        }
        if (searchHits.has(n.id)) br *= 1.7 + 0.7 * Math.sin(nowT * 6);
        if (isOrphan[i]) br *= 0.65;
        m.scale.setScalar(sc);
        const mat = m.material as THREE.MeshBasicMaterial;
        if (isHole[i]) mat.color.setRGB(0, 0, 0); else mat.color.copy(baseCols[i]).multiplyScalar(br);
      });

      // Kanten
      activeLinks.length = 0;
      for (let k = 0; k < links.length; k++) {
        const si = linkS[k], ti = linkT[k];
        const s = nodes[si], tt2 = nodes[ti], o = k * 6;
        linePos[o] = P[si].x; linePos[o + 1] = P[si].y; linePos[o + 2] = P[si].z;
        linePos[o + 3] = P[ti].x; linePos[o + 4] = P[ti].y; linePos[o + 5] = P[ti].z;
        const vis = Math.min(appear[si], appear[ti]);
        const inSpot = spot ? spot.has(si) && spot.has(ti) && (!spotPairs || spotPairs.has(linkKey[k])) : ai < 0 || si === ai || ti === ai;
        const on = vis > 0.05 && inSel(s) && inSel(tt2) && inSpot;
        linkOn[k] = on ? 1 : 0;
        if (on) activeLinks.push(k);
        const route = on && !!spotPairs;
        const kk2 = (vis < 0.05 ? 0 : route ? 2.2 : on ? (ai >= 0 || spot ? 1.2 : 0.55) : 0.03) * vis;
        const cs = route ? GOLD : baseCols[si], ct = route ? GOLD : baseCols[ti];
        lineCol[o] = cs.r * kk2; lineCol[o + 1] = cs.g * kk2; lineCol[o + 2] = cs.b * kk2;
        lineCol[o + 3] = ct.r * kk2; lineCol[o + 4] = ct.g * kk2; lineCol[o + 5] = ct.b * kk2;
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
      stars.rotation.y += 0.00008;

      // Dunkle Materie
      for (let k = 0; k < dmCount; k++) {
        const d = dms[k];
        tmp2.set(0, 0, 0);
        let vis = 0, act = 0;
        d.srcs.forEach((s) => { tmp2.add(P[s]); vis = Math.max(vis, appear[s]); if (inSel(nodes[s])) act = Math.max(act, 1); });
        tmp2.divideScalar(d.srcs.length);
        dmP[k].copy(tmp2).add(d.off);
        dmPosArr[k * 3] = dmP[k].x; dmPosArr[k * 3 + 1] = dmP[k].y; dmPosArr[k * 3 + 2] = dmP[k].z;
        let b = 0.55 + 0.25 * Math.sin(nowT * 1.3 + k);
        const lit = ai >= 0 ? d.srcs.includes(ai) : spot ? d.srcs.some((s) => spot!.has(s)) : true;
        b *= vis * act * (lit ? 1 : 0.12) * (k === dmHover ? 2.6 : 1);
        dmColArr[k * 3] = DM_COL.r * b; dmColArr[k * 3 + 1] = DM_COL.g * b; dmColArr[k * 3 + 2] = DM_COL.b * b;
      }
      if (dmCount) {
        dmGeo.attributes.position.needsUpdate = true; dmGeo.attributes.color.needsUpdate = true;
        dmSegs.forEach(([k, s], j) => {
          const o = j * 6;
          dmLinePos[o] = dmP[k].x; dmLinePos[o + 1] = dmP[k].y; dmLinePos[o + 2] = dmP[k].z;
          dmLinePos[o + 3] = P[s].x; dmLinePos[o + 4] = P[s].y; dmLinePos[o + 5] = P[s].z;
          const f = Math.min(1, appear[s]) * (inSel(nodes[s]) ? 1 : 0) * (ai >= 0 ? (s === ai ? 1 : 0.03) : spot ? (spot.has(s) ? 0.8 : 0.03) : 0.35) * 0.55;
          dmLineCol[o] = dmLineCol[o + 3] = DM_COL.r * f; dmLineCol[o + 1] = dmLineCol[o + 4] = DM_COL.g * f; dmLineCol[o + 2] = dmLineCol[o + 5] = DM_COL.b * f;
        });
        dmLineGeo.attributes.position.needsUpdate = true; dmLineGeo.attributes.color.needsUpdate = true;
      }

      // Monde und Planeten
      if (orbs.length) {
        orbs.forEach((o, j) => {
          const i = o.i, base = meshes[i].userData.base as number;
          const R = o.planet ? base * 4.2 + 7 : base * 2.4 + 3;
          const a = nowT * o.speed + o.phase;
          const p = P[i];
          orbPos[j * 3] = p.x + (o.u.x * Math.cos(a) + o.v.x * Math.sin(a)) * R;
          orbPos[j * 3 + 1] = p.y + (o.u.y * Math.cos(a) + o.v.y * Math.sin(a)) * R;
          orbPos[j * 3 + 2] = p.z + (o.u.z * Math.cos(a) + o.v.z * Math.sin(a)) * R;
          const b = (appear[i] > 0.5 ? 1 : 0) * (actOf(i) ? 1.5 : 0.08);
          if (o.planet) { orbCol[j * 3] = 0.6 * b; orbCol[j * 3 + 1] = 0.9 * b; orbCol[j * 3 + 2] = 1.0 * b; }
          else { orbCol[j * 3] = 1.0 * b; orbCol[j * 3 + 1] = 0.5 * b; orbCol[j * 3 + 2] = 0.34 * b; }
        });
        orbGeo.attributes.position.needsUpdate = true; orbGeo.attributes.color.needsUpdate = true;
      }

      // Expansions-Ringe
      ringGroup.visible = ringK > 0.02;
      if (ringGroup.visible) {
        ringMat.opacity = 0.22 * ringK;
        const showR = ringK > 0.5 && !cinema.on;
        ringLblOld.toggleClass("on", showR); ringLblNew.toggleClass("on", showR);
        [[ringLblOld, 244], [ringLblNew, 34]].forEach(([el, r]) => {
          tmp.set(r as number, 0, 0).project(camera);
          (el as HTMLElement).style.left = (tmp.x * 0.5 + 0.5) * W + "px";
          (el as HTMLElement).style.top = (-tmp.y * 0.5 + 0.5) * H + "px";
          if (tmp.z > 1) (el as HTMLElement).removeClass("on");
        });
      } else { ringLblOld.removeClass("on"); ringLblNew.removeClass("on"); }

      // Sternbild-Linien + Label
      if (conEdges.length) {
        conEdges.forEach(([a, b], k) => {
          conPos[k * 6] = P[a].x; conPos[k * 6 + 1] = P[a].y; conPos[k * 6 + 2] = P[a].z;
          conPos[k * 6 + 3] = P[b].x; conPos[k * 6 + 4] = P[b].y; conPos[k * 6 + 5] = P[b].z;
        });
        conGeo.setDrawRange(0, conEdges.length * 2);
        conGeo.attributes.position.needsUpdate = true;
        const [cx, cy, cz] = (conLabel.dataset.cx ?? "0,0,0").split(",").map(Number);
        tmp.set(cx, cy, cz).project(camera);
        conLabel.toggleClass("on", tmp.z < 1);
        conLabel.style.left = (tmp.x * 0.5 + 0.5) * W + "px";
        conLabel.style.top = (-tmp.y * 0.5 + 0.5) * H + "px";
      }

      // Kometen
      const cometLive = Math.round(cometN * COMET_Q[Math.min(quality, 2)]);
      for (let c = 0; c < cometLive; c++) {
        cP[c] += cSpd[c] * dt;
        if (cLink[c] < 0 || cP[c] >= 1 || !linkOn[cLink[c]]) {
          if (activeLinks.length) {
            const fresh = cSpd[c] === 0;
            cLink[c] = activeLinks[(Math.random() * activeLinks.length) | 0];
            cP[c] = fresh ? Math.random() : 0;
            cSpd[c] = rnd(0.28, 0.65); cDir[c] = Math.random() < 0.5 ? 1 : -1;
          } else cLink[c] = -1;
        }
        for (let j = 0; j < TR; j++) {
          const o = c * TR * 3 + j * 3;
          if (cLink[c] < 0) { cCol[o] = cCol[o + 1] = cCol[o + 2] = 0; continue; }
          const L = cLink[c];
          const pj = Math.min(1, Math.max(0, cP[c] - trail[j]));
          const q = cDir[c] > 0 ? pj : 1 - pj;
          const a = P[linkS[L]], b = P[linkT[L]];
          cPos[o] = a.x + (b.x - a.x) * q; cPos[o + 1] = a.y + (b.y - a.y) * q; cPos[o + 2] = a.z + (b.z - a.z) * q;
          const col = baseCols[cDir[c] > 0 ? linkS[L] : linkT[L]];
          const f = trailB[j] * Math.sin(Math.PI * Math.min(1, Math.max(0, cP[c]))) * (ai >= 0 || spot ? 1.5 : 1.0);
          const wm = j === 0 ? 0.6 : j === 1 ? 0.25 : 0;
          cCol[o] = (col.r + (1 - col.r) * wm) * f; cCol[o + 1] = (col.g + (1 - col.g) * wm) * f; cCol[o + 2] = (col.b + (1 - col.b) * wm) * f;
        }
      }
      cGeo.attributes.position.needsUpdate = true;
      cGeo.attributes.color.needsUpdate = true;

      // Nebel
      nebulae.forEach((nb) => {
        if (!nb) return;
        let cx = 0, cy = 0, cz = 0, k = 0;
        nb.members.forEach((i) => { if (appear[i] > 0.5) { cx += P[i].x; cy += P[i].y; cz += P[i].z; k++; } });
        const selOk = selected.size === 0 || selected.has(nb.folder);
        if (k < 3) { (nb.sprite.material as THREE.SpriteMaterial).opacity = 0; nb.label.removeClass("on"); return; }
        cx /= k; cy /= k; cz /= k;
        let r = 0;
        nb.members.forEach((i) => { if (appear[i] > 0.5) r += Math.hypot(P[i].x - cx, P[i].y - cy, P[i].z - cz); });
        r = (r / k) * 2.4 + 30;
        nb.sprite.position.set(cx, cy, cz);
        nb.sprite.scale.setScalar(r * 2.2);
        const d = camera.position.distanceTo(nb.sprite.position);
        const clear = Math.min(1, Math.max(0, (d - r * 0.5) / (r * 1.3)));
        const fade = clear * clear * (3 - 2 * clear);
        (nb.sprite.material as THREE.SpriteMaterial).opacity = 0.14 * S.nebula * nebK * (1 - (S.denseCore ? 0 : 0.35) * expK) * fade * (selected.size === 0 ? 1 : selOk ? 1.6 : 0.12) * (spot ? 0.4 : 1);
        tmp.set(cx, cy, cz).project(camera);
        const vis = tmp.z < 1 && !anchor && !spot && fade > 0.15 && selOk && S.nebula > 0.05;
        nb.label.toggleClass("on", vis);
        if (vis) { nb.label.style.left = (tmp.x * 0.5 + 0.5) * W + "px"; nb.label.style.top = (-tmp.y * 0.5 + 0.5) * H + "px"; }
      });

      // Schwarze Löcher (+ Gravitationslinse)
      const lensU = LENS_SHADER.uniforms.uHoles.value;
      lensPass.uniforms.uAspect.value = W / H;
      disks.forEach((d, k) => {
        d.mesh.visible = meshes[d.i].visible;
        d.mesh.position.copy(P[d.i]);
        const worldR = meshes[d.i].scale.x * 3.2;
        d.mesh.scale.setScalar(worldR);
        d.mesh.rotation.z += dt * 0.5 * spin;
        d.mat.opacity = (actOf(d.i) ? 0.95 : 0.08) * Math.min(1, appear[d.i]);
        tmp.copy(P[d.i]).project(camera);
        if (tmp.z < 1 && d.mesh.visible) {
          const dist = camera.position.distanceTo(P[d.i]);
          lensU[k].set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5, (worldR / (dist * Math.tan((camera.fov * Math.PI) / 360))) * 0.5 * 0.9);
        } else lensU[k].z = 0;
      });
      for (let k = disks.length; k < 3; k++) lensU[k].z = 0;

      // Fokus-Halo
      const hi = cinema.on ? cinema.target : focusOn && focusNode ? idx.get(focusNode.id)! : -1;
      halo.visible = hi >= 0 && appear[hi] > 0.5;
      if (halo.visible) {
        halo.position.copy(P[hi]);
        halo.scale.setScalar(50 + 8 * Math.sin(nowT * 1.8));
        (halo.material as THREE.SpriteMaterial).color.copy(baseCols[hi]).lerp(new THREE.Color(0xffffff), 0.5);
      }

      // Ripples
      for (let r = ripples.length - 1; r >= 0; r--) {
        const age = (nowT - ripples[r].t0) / 1.3;
        const sp2 = ripples[r].sprite;
        if (age >= 1) { scene.remove(sp2); (sp2.material as THREE.Material).dispose(); ripples.splice(r, 1); continue; }
        sp2.scale.setScalar(10 + age * 120);
        (sp2.material as THREE.SpriteMaterial).opacity = 0.95 * (1 - age) * (1 - age);
      }

      // Sternschnuppe
      if (!ss.active && nowT > ss.next && S.shootingStars) {
        camera.getWorldDirection(tmp);
        const right = tmp2.crossVectors(tmp, camera.up).normalize().clone();
        const up = new THREE.Vector3().crossVectors(right, tmp).normalize();
        ss.head.copy(camera.position).addScaledVector(tmp, 500).addScaledVector(right, rnd(-380, 380)).addScaledVector(up, rnd(-100, 300));
        ss.dir.copy(right).multiplyScalar(rnd(-1, 1)).addScaledVector(up, -rnd(0.25, 0.8)).normalize();
        ss.active = true; ss.t = 0; ss.dur = rnd(0.6, 1.0);
      }
      if (ss.active) {
        ss.t += dt;
        ss.head.addScaledVector(ss.dir, 850 * dt);
        const len = 150 * Math.min(1, ss.t * 6);
        ssPos[3] = ss.head.x; ssPos[4] = ss.head.y; ssPos[5] = ss.head.z;
        ssPos[0] = ss.head.x - ss.dir.x * len; ssPos[1] = ss.head.y - ss.dir.y * len; ssPos[2] = ss.head.z - ss.dir.z * len;
        ssGeo.attributes.position.needsUpdate = true;
        ssMat.opacity = Math.max(0, 1 - ss.t / ss.dur);
        if (ss.t >= ss.dur) { ss.active = false; ssMat.opacity = 0; ss.next = nowT + rnd(4, 10); }
      }

      // Labels
      nodes.forEach((n, i) => {
        const show = appear[i] > 0.5 && inSel(n) && !cinema.on && (i === ai || (an?.has(i) ?? false) || (!spot && ai < 0 && hubs.has(n.id)) || (!!spot && spot.size <= 14 && spot.has(i)) || (searchHits.has(n.id) && searchHits.size <= 8));
        const el = labels[i];
        el.toggleClass("on", show);
        if (!show) return;
        tmp.copy(P[i]).project(camera);
        if (tmp.z > 1) { el.removeClass("on"); return; }
        el.style.left = (tmp.x * 0.5 + 0.5) * W + "px";
        el.style.top = (-tmp.y * 0.5 + 0.5) * H + "px";
      });

      // Minimap
      if (frameNo % 2 === 0) {
        if (frameNo % 40 === 2 || frameNo < 5) {
          const vals = nodes.map((_, i) => { const q = mr(P[i].x, P[i].y, P[i].z); return Math.max(Math.abs(q[0]), Math.abs(q[1])); }).sort((a, b) => a - b);
          mExt = Math.max(40, vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))] ?? 100) * 1.15;
        }
        mScale = 140 / mExt;
        const cl = (v: number) => Math.max(-145, Math.min(145, v));
        mg.clearRect(0, 0, 300, 300);
        nodes.forEach((n, i) => {
          if (appear[i] < 0.05) return;
          mg.globalAlpha = (inSel(n) ? 0.9 : 0.12) * Math.min(1, appear[i]);
          mg.fillStyle = "#" + baseCols[i].getHexString();
          const q = mr(P[i].x, P[i].y, P[i].z);
          const px = 150 + cl(q[0] * mScale), py = 150 - cl(q[1] * mScale);
          if (isHole[i]) { mg.beginPath(); mg.arc(px, py, 4, 0, Math.PI * 2); mg.fill(); }
          else { const sz = 1.6 + Math.min(2, n.deg * 0.08); mg.fillRect(px - sz / 2, py - sz / 2, sz, sz); }
        });
        mg.globalAlpha = 0.9; mg.strokeStyle = "#ffffff"; mg.lineWidth = 2;
        const tq = mr(controls.target.x, controls.target.y, controls.target.z);
        const tx = 150 + cl(tq[0] * mScale), ty = 150 - cl(tq[1] * mScale);
        mg.beginPath(); mg.arc(tx, ty, 9, 0, Math.PI * 2); mg.stroke();
        const cq = mr(camera.position.x, camera.position.y, camera.position.z);
        const cx2 = 150 + cl(cq[0] * mScale), cy2 = 150 - cl(cq[1] * mScale);
        mg.globalAlpha = 0.5; mg.beginPath(); mg.moveTo(tx, ty); mg.lineTo(cx2, cy2); mg.stroke();
        mg.globalAlpha = 1;
      }

      composer.render();
      if (shotRequested) { shotRequested = false; takePhoto(); }
    };
    pendingRestore = () => {
      if (st.query) { sIn.value = st.query; doSearch(); }
      if (st.tag) setTag(st.tag, false);
      else if (st.route) {
        const a = idx.get(st.route[0]), b = idx.get(st.route[1]);
        if (a !== undefined && b !== undefined) { const path = shortest(a, b); if (path) setRoute(path, false); }
      }
    };
    frame();

    this.ro = new ResizeObserver(() => {
      renderer.setSize(w(), h());
      composer.setSize(w(), h());
      camera.aspect = w() / h();
      camera.updateProjectionMatrix();
    });
    this.ro.observe(root);

    this.disposeFns.push(() => {
      saveState();
      stopRec();
      window.clearInterval(saveTimer);
      window.removeEventListener("keydown", onKey);
      sim.stop();
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("dblclick", onDbl);
      controls.dispose();
      window.clearTimeout(ambientTimer);
      if (audioCtx) { try { audioCtx.close(); } catch { /* egal */ } }
    });
  }
}
