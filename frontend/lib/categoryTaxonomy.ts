// ==============================================================================
// PROCUREMENT CATEGORY TAXONOMY REGISTRY
// ==============================================================================
// The major/minor category master, fetched once from the backend and shared by
// every screen that renders a category picker: the buyer ingestion wizard, the
// manual and edit RFQ modals, the buyer account table, the vendor profile and the
// category manager dashboards.
//
// The registry starts EMPTY and there is no fallback. A screen that has not
// loaded the taxonomy yet shows no options and says so, rather than showing
// options that may not exist. `useApp()` exposes the loaded value plus the load
// error; this module exists for the non-React validation code that cannot read
// context.
// ==============================================================================

import type { MajorMinorCategory } from './types';

// ==============================================================================
// KEYWORD MATCHING AND RULE DEFINITIONS
// ==============================================================================

const MATERIAL_ONLY_KEYWORDS = new Set([
  'steel', 'steels', 'rubber', 'copper', 'brass', 'aluminium', 'aluminum',
  'iron', 'cast iron', 'lubricant', 'lubricants'
]);

/**
 * Known keyword matching rules.
 * Ordered from MORE SPECIFIC to generic rules to prevent precedence collisions.
 * Every major and minor matches EXACTLY one of the 13 majors and 309 minors in the master.
 */
export const KNOWN_KEYWORD_RULES: Array<{
  keywords: string[];
  major: string;
  minor: string;
}> = [
  // ── IT (Specific Networking & Hardware first before electrical cables/switches) ──
  {
    keywords: ['network switch', 'data cable', 'patch cord', 'server rack', 'lan cable', 'ethernet switch'],
    major: 'IT',
    minor: 'Networking Equipment',
  },
  {
    keywords: ['barcode scanner', 'barcode scanners', 'qr scanner'],
    major: 'IT',
    minor: 'BARCODE SCANNERS',
  },
  {
    keywords: ['cctv', 'cctv camera', 'ip camera', 'dome camera', 'bullet camera', 'nvr', 'dvr', 'surveillance camera'],
    major: 'IT',
    minor: 'CCTV',
  },
  {
    keywords: ['laptop', 'laptops', 'notebook'],
    major: 'IT',
    minor: 'Laptop',
  },
  {
    keywords: ['desktop', 'desktops', 'computer', 'computers', 'all-in-one pc'],
    major: 'IT',
    minor: 'Computer',
  },
  {
    keywords: ['server', 'servers', 'rack server', 'blade server'],
    major: 'IT',
    minor: 'Servers',
  },
  {
    keywords: ['printer', 'printers', 'laser printer', 'inkjet printer', 'multifunction printer'],
    major: 'IT',
    minor: 'Printers',
  },
  {
    keywords: ['software', 'software license', 'software licenses', 'operating system', 'antivirus'],
    major: 'IT',
    minor: 'Software',
  },
  {
    keywords: ['router', 'routers', 'access point', 'wifi router', 'networking equipment'],
    major: 'IT',
    minor: 'Networking Equipment',
  },
  {
    keywords: ['hard disk', 'ssd', 'hdd', 'ram', 'motherboard', 'graphics card', 'hardware'],
    major: 'IT',
    minor: 'Hardware',
  },
  {
    keywords: ['toner', 'cartridge toner', 'printer ribbon', 'it consumable', 'it consumables'],
    major: 'IT',
    minor: 'IT Consumables',
  },
  {
    keywords: ['audio visual equipment', 'projector', 'av display', 'video conferencing'],
    major: 'IT',
    minor: 'Audio Visual Equipment',
  },
  {
    keywords: ['telecom', 'voip phone', 'epabx', 'intercom', 'telecom & security products'],
    major: 'IT',
    minor: 'Telecom & Security Products',
  },

  // ── Safety / Occuptional Health and Safety (Specific rules before general hoses/jackets) ──
  {
    keywords: ['fire extinguisher', 'fire extinguishers', 'extinguisher', 'extinguishers'],
    major: 'Occuptional Health and Safety',
    minor: 'Fire Extinguishers',
  },
  {
    keywords: ['safety harness', 'harness', 'fall arrest', 'fall protection', 'safety belt'],
    major: 'Occuptional Health and Safety',
    minor: 'Harness',
  },
  {
    keywords: ['helmet', 'helmets', 'hard hat', 'hard hats', 'safety helmet'],
    major: 'Occuptional Health and Safety',
    minor: 'Helmets',
  },
  {
    keywords: ['safety jacket', 'safety jackets', 'high vis jacket', 'reflective jacket'],
    major: 'Occuptional Health and Safety',
    minor: 'Safety jackets',
  },
  {
    keywords: ['safety shoe', 'safety shoes', 'safety boot', 'safety boots', 'gumboot', 'gumboots'],
    major: 'Occuptional Health and Safety',
    minor: 'Safety Shoes',
  },
  {
    keywords: ['glove', 'gloves', 'safety gloves', 'nitrile gloves', 'leather gloves', 'hand protection'],
    major: 'Occuptional Health and Safety',
    minor: 'Gloves',
  },
  {
    keywords: ['medicine', 'medicines', 'first aid', 'first aid kit', 'bandage', 'antiseptic'],
    major: 'Occuptional Health and Safety',
    minor: 'Medicines',
  },
  {
    keywords: ['public announcement system (pas)', 'public announcement system', 'pas system'],
    major: 'Occuptional Health and Safety',
    minor: 'Public Announcement System (PAS)',
  },
  {
    keywords: ['seafty equipments', 'safety equipment', 'ppe kit', 'face shield'],
    major: 'Occuptional Health and Safety',
    minor: 'Seafty Equipments',
  },

  // ── Packing Material (Corrugated boxes, bubble wrap, etc. -> Packing Material, not Others) ──
  {
    keywords: ['corrugated box', 'corrugated boxes', 'carton', 'cartons', 'carton box'],
    major: 'Packing Material',
    minor: 'Corrugated Boxes',
  },
  {
    keywords: ['corrugated roll', 'corrugated rolls'],
    major: 'Packing Material',
    minor: 'Corrugated Rolls',
  },
  {
    keywords: ['bubble roll', 'bubble rolls', 'bubble wrap', 'air bubble sheet'],
    major: 'Packing Material',
    minor: 'Bubble Rolls',
  },
  {
    keywords: ['shrink flim', 'shrink flims', 'shrink film', 'stretch film', 'cling film'],
    major: 'Packing Material',
    minor: 'Shrink Flims',
  },
  {
    keywords: ['tape', 'tapes', 'adhesive tape', 'bopj tape', 'masking tape', 'packing tape'],
    major: 'Packing Material',
    minor: 'Tapes',
  },
  {
    keywords: ['pallet', 'pallets', 'wooden pallet', 'plastic pallet'],
    major: 'Packing Material',
    minor: 'Pallets',
  },
  {
    keywords: ['drum', 'drums', 'ms drum', 'plastic drum', 'barrel', 'barrels'],
    major: 'Packing Material',
    minor: 'Drums',
  },
  {
    keywords: ['hdpe bottle', 'hdpe bottles'],
    major: 'Packing Material',
    minor: 'Hdpe Bottles',
  },
  {
    keywords: ['pet jar', 'pet jars'],
    major: 'Packing Material',
    minor: 'Pet Jars',
  },
  {
    keywords: ['strapping machine', 'strapping machines', 'box strapping machine'],
    major: 'Packing Material',
    minor: 'Strapping Machines',
  },
  {
    keywords: ['thermocol material', 'thermocol materials', 'eps packing', 'thermocol'],
    major: 'Packing Material',
    minor: 'Thermocol Materials',
  },
  {
    keywords: ['woven bag', 'woven bags', 'gunny bag', 'pp woven sack'],
    major: 'Packing Material',
    minor: 'woven Bags',
  },
  {
    keywords: ['paper box', 'paper boxes'],
    major: 'Packing Material',
    minor: 'Paper Boxes',
  },
  {
    keywords: ['label', 'labels', 'tag', 'tags', 'labels & tags', 'barcode label'],
    major: 'Packing Material',
    minor: 'Labels & Tags',
  },
  {
    keywords: ['laminated pouch', 'laminated pouches', 'pouch packing'],
    major: 'Packing Material',
    minor: 'Laminated pouch',
  },

  // ── CAPEX - Equipment & Machinery ──
  {
    keywords: ['ups', 'online ups', 'industrial ups'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'UPS',
  },
  {
    keywords: ['diesel generator', 'diesel genset', 'diesel gensets', 'dg set', 'generator set'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Diesel Gensets',
  },
  {
    keywords: ['air conditioner', 'air conditioners', 'chiller', 'split ac', 'ductable ac'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Air Conditioners',
  },
  {
    keywords: ['cnc machine', 'cnc machines', 'cnc milling', 'vmc machine'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'CNC Machines',
  },
  {
    keywords: ['crane', 'cranes', 'eot crane', 'overhead crane', 'gantry crane', 'hoist'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Cranes',
  },
  {
    keywords: ['forklift', 'forklifts', 'fork lift', 'fork lifts', 'stacker', 'reach truck'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Fork Lifts',
  },
  {
    keywords: ['excavator', 'excavators', 'jcb', 'earth mover'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Excavators',
  },
  {
    keywords: ['lathe machine', 'lathe machines', 'lathe'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Lathe Machines',
  },
  {
    keywords: ['surgical instrument', 'surgical instruments', 'scalpel', 'forceps'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Surgical Instruments',
  },
  {
    keywords: ['stabilizer', 'stabilizers', 'voltage stabilizer', 'servo stabilizer'],
    major: 'CAPEX - Equipment & Machinery',
    minor: 'Stabilizers',
  },

  // ── Engineering Spares - Electrical ──
  {
    keywords: ['battery', 'batteries', 'smf battery', 'lead acid battery'],
    major: 'Engineering Spares - Electrical',
    minor: 'Batteries',
  },
  {
    keywords: ['inverter', 'inverters', 'rectifier', 'rectifiers', 'converter', 'converters'],
    major: 'Engineering Spares - Electrical',
    minor: 'Converters',
  },
  {
    keywords: ['transformer', 'transformers', 'power transformer', 'distribution transformer'],
    major: 'Engineering Spares - Electrical',
    minor: 'Transformers',
  },
  {
    keywords: ['motor', 'motors', 'induction motor', 'electric motor', 'servo motor'],
    major: 'Engineering Spares - Electrical',
    minor: 'Motors',
  },
  {
    keywords: ['cable', 'cables', 'wire', 'wires', 'power cable', 'armoured cable', 'copper wire'],
    major: 'Engineering Spares - Electrical',
    minor: 'Cables',
  },
  {
    keywords: ['panel', 'panels', 'switchboard', 'distribution board', 'mcc panel', 'pcc panel', 'control panel'],
    major: 'Engineering Spares - Electrical',
    minor: 'Panels',
  },
  {
    keywords: ['circuit breaker', 'circuit breakers', 'mccb', 'mcb', 'acb', 'elcb', 'rccb', 'vcb'],
    major: 'Engineering Spares - Electrical',
    minor: 'Circuit Breakers',
  },
  {
    keywords: ['switchgear', 'switchgears', 'electrical-lv switch gears', 'ht switchgear', 'lt switchgear'],
    major: 'Engineering Spares - Electrical',
    minor: 'Electrical-Lv Switch Gears',
  },
  {
    keywords: ['switch', 'switches', 'limit switch', 'push button switch', 'toggle switch'],
    major: 'Engineering Spares - Electrical',
    minor: 'Switches',
  },
  {
    keywords: ['light', 'lights', 'led light', 'flood light', 'bay light', 'luminaire'],
    major: 'Engineering Spares - Electrical',
    minor: 'Lights',
  },
  {
    keywords: ['dg parts', 'generator spare', 'dg spares'],
    major: 'Engineering Spares - Electrical',
    minor: 'DG Parts',
  },
  {
    keywords: ['earthing item', 'earthing items', 'earthing strip', 'copper earth rod'],
    major: 'Engineering Spares - Electrical',
    minor: 'Earthing Items',
  },
  {
    keywords: ['electronic item', 'electronic items', 'pcb', 'electronic component'],
    major: 'Engineering Spares - Electrical',
    minor: 'Electronic Items',
  },
  {
    keywords: ['connector', 'connectors', 'terminal block', 'lug', 'cable lugs'],
    major: 'Engineering Spares - Electrical',
    minor: 'Connectors',
  },

  // ── Engineering Spares - Mechanical ──
  {
    keywords: ['pump', 'pumps', 'centrifugal pump', 'submersible pump', 'vacuum pump', 'dosing pump', 'impeller'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Pumps & Accessories',
  },
  {
    keywords: ['compressor', 'compressors', 'air compressor', 'screw compressor'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Compressors & Accessories',
  },
  {
    keywords: ['valve', 'valves', 'ball valve', 'gate valve', 'globe valve', 'check valve', 'butterfly valve', 'solenoid valve', 'hose', 'hoses', 'hydraulic hose', 'flange', 'flanges'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Hoses, Valves & Fittings',
  },
  {
    keywords: ['pipe', 'pipes', 'piping', 'tubing', 'tube', 'tubes', 'pipe fitting', 'seamless pipe'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Pipes & Pipe Fittings',
  },
  {
    keywords: ['filter', 'filters', 'air filter', 'oil filter', 'cartridge filter', 'hydraulic filter'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Filters',
  },
  {
    keywords: ['fastener', 'fasteners', 'bolt', 'bolts', 'nut', 'nuts', 'screw', 'screws', 'washer', 'washers', 'stud', 'studs'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Fasteners',
  },
  {
    keywords: ['tool', 'tools', 'tools & tackles', 'wrench', 'spanner', 'pliers'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Tools & Tackles',
  },
  {
    keywords: ['bearing', 'bearings', 'ball bearing', 'roller bearing', 'pillow block bearing'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Bearings & Accessories',
  },
  {
    keywords: ['gearbox', 'gearboxes', 'gearboxes & spares', 'gear box', 'reduction gearbox'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Gearboxes & Spares',
  },
  {
    keywords: ['o-rings / gasket / seals', 'o-ring', 'o rings', 'gasket', 'gaskets', 'mechanical seal', 'oil seal'],
    major: 'Engineering Spares - Mechanical',
    minor: 'O-Rings / Gasket / Seals',
  },
  {
    keywords: ['fabrication', 'structural fabrication', 'sheet metal fabrication', 'ms fabrication'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Fabrication',
  },
  {
    keywords: ['blower', 'blowers', 'centrifugal blower', 'air blower'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Blower',
  },
  {
    keywords: ['industrial fan', 'industrial fans', 'exhaust fan', 'ventilation fan'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Industrial Fan',
  },
  {
    keywords: ['adhesive', 'adhesives', 'sealant', 'sealants', 'epoxy adhesive', 'silicone sealant'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Adhesives',
  },
  {
    keywords: ['abrasive', 'abrasives', 'grinding wheel', 'cutting wheel', 'sandpaper', 'emery paper'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Abrasives',
  },
  {
    keywords: ['machinery part', 'machinery parts', 'machine spare'],
    major: 'Engineering Spares - Mechanical',
    minor: 'Machinery Parts',
  },

  // ── Civil Works ──
  {
    keywords: ['rebar', 'rebars', 'tmt', 'tmt bar', 'tmt bars', 'reinforcement bar', 'tmt bars fe 500'],
    major: 'Civil Works',
    minor: 'TMT BARS',
  },
  {
    keywords: ['peb', 'peb structure', 'pre-engineered building', 'steel shed'],
    major: 'Civil Works',
    minor: 'PEB Structure',
  },
  {
    keywords: ['roofing sheet', 'roofing sheets', 'profile sheet', 'corrugated sheet'],
    major: 'Civil Works',
    minor: 'Roofing Sheets',
  },
  {
    keywords: ['paint', 'paints', 'wall paint', 'primer', 'enamel paint', 'acrylic paint'],
    major: 'Civil Works',
    minor: 'Paints',
  },
  {
    keywords: ['brick', 'bricks', 'fly ash brick', 'red brick', 'clay brick'],
    major: 'Civil Works',
    minor: 'Bricks',
  },
  {
    keywords: ['plumbing', 'drainage pipe', 'sanitary pipe', 'water pipe'],
    major: 'Civil Works',
    minor: 'Plumbing',
  },
  {
    keywords: ['waterproofing', 'waterproofing compound', 'waterproofing chemical'],
    major: 'Civil Works',
    minor: 'Waterproofing',
  },
  {
    keywords: ['flooring material', 'floor tiles', 'vitrified tiles', 'granite slab', 'marble slab'],
    major: 'Civil Works',
    minor: 'Flooring Material',
  },
  {
    keywords: ['gypsum board', 'gypsum boards', 'false ceiling board'],
    major: 'Civil Works',
    minor: 'Gypsum Board',
  },

  // ── Raw Material ──
  {
    keywords: ['chemical', 'chemicals', 'hydrochloric acid', 'sulfuric acid', 'caustic soda', 'sodium hydroxide'],
    major: 'Raw Material',
    minor: 'Chemicals',
  },
  {
    keywords: ['lubricant', 'lubricants', 'engine oil', 'hydraulic oil', 'gear oil', 'industrial grease'],
    major: 'Raw Material',
    minor: 'Lubricants',
  },
  {
    keywords: ['gas', 'gases', 'industrial gas', 'oxygen gas', 'nitrogen gas', 'argon gas', 'acetylene'],
    major: 'Raw Material',
    minor: 'Gases',
  },
  {
    keywords: ['steel', 'steels', 'ms plate', 'steel plate', 'steel sheet', 'angle iron', 'ms angle', 'ms channel', 'i beam'],
    major: 'Raw Material',
    minor: 'Steels',
  },
  {
    keywords: ['aluminium', 'aluminum', 'aluminium sheet', 'aluminium rod', 'aluminium ingot'],
    major: 'Raw Material',
    minor: 'Aluminium',
  },
  {
    keywords: ['copper', 'copper rod', 'copper sheet', 'copper cathode'],
    major: 'Raw Material',
    minor: 'Copper',
  },
  {
    keywords: ['coal', 'coking coal', 'thermal coal'],
    major: 'Raw Material',
    minor: 'Coal',
  },

  // ── Logistics ──
  {
    keywords: ['road transport', 'truck transport', 'trucking', 'trailer', 'lorry', 'ftl transport', 'ltl transport'],
    major: 'Logistics',
    minor: 'Road transport',
  },
  {
    keywords: ['air logistics', 'air freight', 'air cargo'],
    major: 'Logistics',
    minor: 'Air Logistics',
  },
  {
    keywords: ['sea logistics', 'ocean freight', 'sea cargo', 'shipping container'],
    major: 'Logistics',
    minor: 'Sea Logistics',
  },
  {
    keywords: ['courier', 'parcel', 'courier & parcel', 'speed post', 'parcel delivery'],
    major: 'Logistics',
    minor: 'Courier & Parcel',
  },

  // ── Professional Services ──
  {
    keywords: ['consultant', 'consulting', 'advisory service', 'strategy consultant'],
    major: 'Professional Services',
    minor: 'Consultant',
  },
  {
    keywords: ['security service', 'security services', 'security guard', 'manned guarding'],
    major: 'Professional Services',
    minor: 'Security Service',
  },
  {
    keywords: ['house keeping service', 'housekeeping service', 'cleaning service', 'facility cleaning'],
    major: 'Professional Services',
    minor: 'House Keeping Service',
  },
  {
    keywords: ['manpower service', 'manpower staffing', 'staffing service', 'labour supply'],
    major: 'Professional Services',
    minor: 'Manpower Service',
  },
  {
    keywords: ['pest control service', 'pest control', 'termite treatment'],
    major: 'Professional Services',
    minor: 'Pest Control Service',
  },
  {
    keywords: ['installation service', 'equipment installation service'],
    major: 'Professional Services',
    minor: 'Installation Service',
  },
  {
    keywords: ['erection and commissioning', 'site erection', 'commissioning service'],
    major: 'Professional Services',
    minor: 'Erection and Commissioning',
  },
  {
    keywords: ['design consultancy', 'engineering design consultancy', 'architectural design'],
    major: 'Professional Services',
    minor: 'Design consultancy',
  },

  // ── Others – New Product ──
  {
    keywords: ['health equipment', 'health equipments', 'stethoscope', 'pulse oximeter', 'bp monitor', 'medical device', 'medical equipment'],
    major: 'Others – New Product',
    minor: 'Health Equipments',
  },
  {
    keywords: ['food & beverages', 'food and beverages', 'sugar', 'dal', 'pulses', 'rice', 'wheat', 'tea', 'coffee', 'grocery', 'groceries'],
    major: 'Others – New Product',
    minor: 'Food & Beverages',
  },
  {
    keywords: ['storage rack', 'storage racks', 'slotted angle rack', 'pallet racking', 'cantilever rack'],
    major: 'Others – New Product',
    minor: 'Storage Racks',
  },
  {
    keywords: ['furniture', 'office chair', 'office desk', 'workstation', 'cupboard', 'cabinet', 'locker'],
    major: 'Others – New Product',
    minor: 'Furniture',
  },
  {
    keywords: ['measuring equipment', 'caliper', 'micrometer', 'pressure gauge', 'temperature gauge', 'flow meter', 'vernier caliper'],
    major: 'Others – New Product',
    minor: 'Measuring Equipment',
  },
  {
    keywords: ['cleanroom solutions', 'cleanroom', 'laminar air flow', 'air shower', 'pass box'],
    major: 'Others – New Product',
    minor: 'Cleanroom Solutions',
  },
  {
    keywords: ['air purifier', 'air purifiers', 'air filter machine'],
    major: 'Others – New Product',
    minor: 'Air Purifiers',
  },
  {
    keywords: ['water treatment plants', 'water treatment plant', 'ro plant', 'effluent treatment plant', 'etp', 'stp'],
    major: 'Others – New Product',
    minor: 'Water Treatment Plants',
  },

  // ── Others – New Service ──
  {
    keywords: ['calibration service', 'calibration services', 'instrument calibration', 'meter calibration'],
    major: 'Others – New Service',
    minor: 'Calibration Services',
  },
  {
    keywords: ['drone survey', 'drone surveys', 'aerial drone survey'],
    major: 'Others – New Service',
    minor: 'Drone Surveys',
  },
  {
    keywords: ['warehousing', 'warehouse storage', 'pallet storage service'],
    major: 'Others – New Service',
    minor: 'Warehousing',
  },
  {
    keywords: ['waste management', 'hazardous waste disposal', 'scrap disposal', 'effluent disposal'],
    major: 'Others – New Service',
    minor: 'Waste Management',
  },
  {
    keywords: ['electroplating services', 'electroplating', 'anodizing service'],
    major: 'Others – New Service',
    minor: 'Electroplating Services',
  },
  {
    keywords: ['corrosion protection', 'anti corrosion coating service'],
    major: 'Others – New Service',
    minor: 'Corrosion Protection',
  },
  {
    keywords: ['pollution control', 'emission monitoring service'],
    major: 'Others – New Service',
    minor: 'Pollution Control',
  },
  {
    keywords: ['appliances services', 'appliance repair', 'ac repair service'],
    major: 'Others – New Service',
    minor: 'Appliances Services',
  },
];

// ==============================================================================
// REGISTRY STATE AND ACCESSORS
// ==============================================================================

/**
 * Trim, collapse whitespace, normalize dashes and spaces around hyphens, and casefold.
 * Ensures 'Others – New Product', 'Others - New Product', 'New Category - Product',
 * and 'New Category-Product' normalize to standard matching keys.
 */
function taxonomyKey(value: string): string {
  return value
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

let groups: MajorMinorCategory[] = [];
let majorsByKey = new Map<string, string>();
let minorsByMajorKey = new Map<string, Map<string, string>>();

/**
 * Replace the registry contents.
 *
 * Called by the store once the fetch resolves.
 * - Trims and collapses whitespace on every major and minor (" IT" -> "IT").
 * - Merges groups whose `taxonomyKey` matches into ONE group with de-duplicated minors.
 * - Maps legacy 'New Category-Product' and bare 'New Category' to 'Others – New Product'.
 * - Maps legacy 'New Category-Service' to 'Others – New Service'.
 * - Contains NO hardcoded fallback arrays; starts empty and purely indexes provided input.
 */
export function setCategoryTaxonomy(next: MajorMinorCategory[]): void {
  const rawList = Array.isArray(next) ? next.filter((g) => Boolean(g && g.majorCategory)) : [];
  const mergedMap = new Map<string, { majorCategory: string; minors: Set<string> }>();

  rawList.forEach((group) => {
    let cleanMajor = group.majorCategory.trim().replace(/\s+/g, ' ');
    if (!cleanMajor) return;

    let key = taxonomyKey(cleanMajor);

    // Map legacy names
    if (key === 'new category' || key === 'new category-product') {
      cleanMajor = 'Others – New Product';
      key = taxonomyKey(cleanMajor);
    } else if (key === 'new category-service') {
      cleanMajor = 'Others – New Service';
      key = taxonomyKey(cleanMajor);
    }

    if (!mergedMap.has(key)) {
      mergedMap.set(key, { majorCategory: cleanMajor, minors: new Set<string>() });
    }
    const entry = mergedMap.get(key)!;

    (group.minorCategories || []).forEach((m) => {
      const cleanMinor = String(m || '').trim().replace(/\s+/g, ' ');
      if (cleanMinor) {
        entry.minors.add(cleanMinor);
      }
    });
  });

  const transformed: MajorMinorCategory[] = [];
  mergedMap.forEach((entry) => {
    transformed.push({
      majorCategory: entry.majorCategory,
      minorCategories: Array.from(entry.minors),
    });
  });

  groups = transformed;
  majorsByKey = new Map();
  minorsByMajorKey = new Map();

  groups.forEach((group) => {
    const majorKey = taxonomyKey(group.majorCategory);
    majorsByKey.set(majorKey, group.majorCategory);
    const minors = new Map<string, string>();
    (group.minorCategories || []).forEach((minor) => {
      if (!minor) return;
      minors.set(taxonomyKey(minor), minor);
    });
    minorsByMajorKey.set(majorKey, minors);
  });
}

/** Everything currently loaded, in master order. */
export function getCategoryTaxonomy(): MajorMinorCategory[] {
  return groups;
}

/** True once a taxonomy has actually been loaded. */
export function isCategoryTaxonomyLoaded(): boolean {
  return groups.length > 0;
}

/** Major categories in master display order. Returns [] if not loaded. */
export function getMajorCategories(): string[] {
  return groups.map((group) => group.majorCategory);
}

/** Minor categories under a major. Returns [] if major not found or registry empty. */
export function getMinorCategories(major: string): string[] {
  if (!major) return [];
  const key = taxonomyKey(major);
  const group = groups.find((g) => taxonomyKey(g.majorCategory) === key);
  return group ? group.minorCategories : [];
}

/** Get the first/default minor category for a given major category. Returns '' if none. */
export function getDefaultMinorForMajor(major: string): string {
  if (!major) return '';
  const minors = getMinorCategories(major);
  return minors.length > 0 ? minors[0] : '';
}

/** Whether the loaded master contains this major category. Returns false if not loaded. */
export function hasMajorCategory(major: string): boolean {
  if (!major) return false;
  return majorsByKey.has(taxonomyKey(major));
}

/** Whether the loaded master contains this minor under this major. Returns false if not loaded. */
export function hasMinorCategory(major: string, minor: string): boolean {
  if (!major || !minor) return false;
  const minors = minorsByMajorKey.get(taxonomyKey(major));
  return Boolean(minors && minors.has(taxonomyKey(minor)));
}

/** Standard procurement category taxonomy fallback when database is unseeded. */
export function getDefaultCategoryTaxonomy(): MajorMinorCategory[] {
  return groups;
}

/**
 * The major category the master owns a minor under, or an empty string.
 * Returns display name from majorsByKey. First major wins for duplicate minors.
 * Returns '' when not found or registry not loaded.
 */
export function findMajorForMinor(minor: string): string {
  if (!minor) return '';
  const key = taxonomyKey(minor);
  for (const group of groups) {
    const majorKey = taxonomyKey(group.majorCategory);
    const minors = minorsByMajorKey.get(majorKey);
    if (minors && minors.has(key)) {
      return majorsByKey.get(majorKey)!;
    }
  }
  return '';
}

/**
 * The most frequent non-empty major category across the given items. Returns ''
 * when none of the items carry a category, so an RFQ header is left empty
 * rather than guessed. `ignore` lets callers exclude synthetic values such as
 * the "All Categories" browse option.
 */
export function dominantMajorCategory(
  items: ReadonlyArray<{ majorCategory?: string | null }>,
  ignore: ReadonlyArray<string> = []
): string {
  const ignoreSet = new Set(ignore.map((value) => value.trim()));
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const major = (item.majorCategory || '').trim();
    if (!major || ignoreSet.has(major)) return;
    counts[major] = (counts[major] || 0) + 1;
  });
  let best = '';
  let bestCount = 0;
  Object.keys(counts).forEach((major) => {
    if (counts[major] > bestCount) {
      best = major;
      bestCount = counts[major];
    }
  });
  return best;
}

/**
 * Keyword matcher: exact token match plus simple plurals (+ 's' or + 'es').
 * For multi-word keywords, requires word-boundary matching.
 * This stops false matches like 'table' -> 'tablet', 'sand' -> 'sandpaper', 'seal' -> 'sealant'.
 */
function matchesRuleKeyword(combined: string, tokens: string[], kw: string): boolean {
  const kwLower = kw.toLowerCase().trim();
  if (kwLower.includes(' ')) {
    const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(combined);
  }
  return tokens.some((token) => token === kwLower || token === `${kwLower}s` || token === `${kwLower}es`);
}

/**
 * Automatically identify and assign the appropriate major and minor category
 * based on item name and technical specifications keywords.
 * Validates rule match output against the currently loaded taxonomy.
 * Returns { majorCategory: '', minorCategory: '' } if taxonomy is not loaded or no rule matches.
 */
export function autoCategorizeItem(
  itemName: string,
  specs = ''
): { majorCategory: string; minorCategory: string } {
  const cleanName = itemName.trim().toLowerCase();
  const cleanSpecs = specs.trim().toLowerCase();
  if (!cleanName && !cleanSpecs) {
    return { majorCategory: '', minorCategory: '' };
  }

  const nameTokens = cleanName ? cleanName.split(/[\s,./\\;:\-_+()\[\]{}|*&^%$#@!~`]+/).filter((t) => t.length >= 2) : [];

  // 1. Priority 1: Match itemName directly against known procurement keyword patterns
  if (cleanName) {
    for (const rule of KNOWN_KEYWORD_RULES) {
      if (rule.keywords.some((kw) => matchesRuleKeyword(cleanName, nameTokens, kw))) {
        if (hasMinorCategory(rule.major, rule.minor)) {
          return { majorCategory: rule.major, minorCategory: rule.minor };
        }
      }
    }
  }

  // 2. Priority 2: Match specs against rules, EXCLUDING isolated material keywords (e.g. steel, plastic)
  if (cleanSpecs) {
    const specsTokens = cleanSpecs.split(/[\s,./\\;:\-_+()\[\]{}|*&^%$#@!~`]+/).filter((t) => t.length >= 2);
    for (const rule of KNOWN_KEYWORD_RULES) {
      const nonMaterialKeywords = rule.keywords.filter((kw) => !MATERIAL_ONLY_KEYWORDS.has(kw.toLowerCase()));
      if (nonMaterialKeywords.some((kw) => matchesRuleKeyword(cleanSpecs, specsTokens, kw))) {
        if (hasMinorCategory(rule.major, rule.minor)) {
          return { majorCategory: rule.major, minorCategory: rule.minor };
        }
      }
    }
  }

  // 3. Priority 3: Match against dynamic registered taxonomy
  if (cleanName) {
    for (const group of groups) {
      const major = group.majorCategory;
      for (const minor of group.minorCategories) {
        if (matchesRuleKeyword(cleanName, nameTokens, minor)) {
          return { majorCategory: major, minorCategory: minor };
        }
      }
      if (matchesRuleKeyword(cleanName, nameTokens, major)) {
        return { majorCategory: major, minorCategory: group.minorCategories[0] || '' };
      }
    }
  }

  // 4. No reliable keyword or taxonomy match found. Never guess.
  return { majorCategory: '', minorCategory: '' };
}

/** Total minor categories across every major, for the summary counters. */
export function countMinorCategories(): number {
  return groups.reduce((total, group) => total + (group.minorCategories?.length || 0), 0);
}

/** Discard the loaded taxonomy. Used by tests and on sign-out. */
export function clearCategoryTaxonomy(): void {
  setCategoryTaxonomy([]);
}
