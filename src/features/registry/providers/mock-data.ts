/**
 * Locale-flavoured vocabulary for DEMO company generation. Every generated
 * company is fictional, marked isDemo, and uses the reserved ".example" TLD
 * for websites/emails so no real organisation is contacted or audited.
 */
export type CountryMockProfile = {
  roots: string[];
  words: Record<string, string[]>;
  legalForms: { code: string; name: string; weight: number }[];
  cities: { city: string; postalCode: string; region: string }[];
  streets: string[];
  firstNames: string[];
  lastNames: string[];
  directorRoles: string[];
  phone: (n: () => number) => string;
  registrationNumber: (n: () => number, date: Date) => string;
  dailyRange: [number, number];
  activeStatus: string;
};

const digits = (n: () => number, len: number) => Array.from({ length: len }, () => Math.floor(n() * 10)).join("");

const BASE_WORDS_EN: Record<string, string[]> = {
  ecommerce: ["Online", "Webshop", "Store"],
  retail: ["Trading", "Shop", "Retail"],
  technology: ["Digital", "Tech", "Software", "Systems"],
  professionalServices: ["Accounting", "Advisory", "Partners"],
  consulting: ["Consulting", "Advisory"],
  construction: ["Construction", "Builders", "Electrical"],
  manufacturing: ["Manufacturing", "Engineering", "Works"],
  printing: ["Print", "Press"],
  design: ["Design", "Studio", "Creative"],
  logistics: ["Logistics", "Transport", "Freight"],
  hospitality: ["Kitchen", "Café", "Hotel"],
  health: ["Health", "Clinic", "Wellness"],
  realEstate: ["Property", "Estates"],
  localServices: ["Cleaning", "Services", "Repairs"],
  other: ["Holding", "Ventures"],
};

export const MOCK_PROFILES: Record<string, CountryMockProfile> = {
  NO: {
    roots: ["Nordlys", "Fjellheim", "Havbris", "Bergtind", "Solvik", "Granli", "Vestkyst", "Elvebakken", "Midnattsol", "Lyngheim", "Furuly", "Steinvik", "Sjøsiden", "Isbre", "Kvitfjell", "Lindås", "Tindefjell", "Bølgen"],
    words: {
      ecommerce: ["Nettbutikk", "Netthandel"], retail: ["Handel", "Butikk"], technology: ["Digital", "Teknologi", "Data"],
      professionalServices: ["Regnskap", "Revisjon"], consulting: ["Rådgivning", "Konsult"], construction: ["Bygg", "Elektro", "Snekker"],
      manufacturing: ["Mekaniske", "Industri"], printing: ["Trykk", "Trykkeri"], design: ["Design", "Studio"],
      logistics: ["Transport", "Logistikk"], hospitality: ["Bakeri", "Kafé", "Kjøkken"], health: ["Helse", "Fysioterapi", "Frisør"],
      realEstate: ["Eiendom"], localServices: ["Renhold", "Bilverksted", "Service"], other: ["Holding", "Invest"],
    },
    legalForms: [{ code: "AS", name: "AS", weight: 70 }, { code: "ENK", name: "ENK", weight: 25 }, { code: "DA", name: "DA", weight: 5 }],
    cities: [
      { city: "Oslo", postalCode: "0150", region: "Oslo" }, { city: "Bergen", postalCode: "5003", region: "Vestland" },
      { city: "Trondheim", postalCode: "7011", region: "Trøndelag" }, { city: "Stavanger", postalCode: "4006", region: "Rogaland" },
      { city: "Tromsø", postalCode: "9008", region: "Troms" }, { city: "Kristiansand", postalCode: "4612", region: "Agder" },
      { city: "Drammen", postalCode: "3015", region: "Buskerud" }, { city: "Bodø", postalCode: "8006", region: "Nordland" },
    ],
    streets: ["Storgata", "Kirkegata", "Strandgata", "Fjordveien", "Parkveien", "Industriveien"],
    firstNames: ["Ingrid", "Lars", "Sofie", "Ola", "Nora", "Henrik", "Maja", "Erik", "Sigrid", "Magnus"],
    lastNames: ["Hansen", "Johansen", "Olsen", "Larsen", "Berg", "Haugen", "Bakke", "Lie", "Dahl", "Moen"],
    directorRoles: ["Daglig leder", "Styreleder"],
    phone: (n) => `+47 ${digits(n, 3)} ${digits(n, 2)} ${digits(n, 3)}`,
    registrationNumber: (n) => `9${digits(n, 8)}`,
    dailyRange: [1, 5],
    activeStatus: "Active",
  },
  SE: {
    roots: ["Norrsken", "Skogsglänta", "Havsvik", "Björkudden", "Solbacken", "Granskog", "Västkust", "Älvdalen", "Fjällvind", "Lingonberg", "Sjöbris", "Ekholmen", "Klippan", "Strandvik"],
    words: {
      ecommerce: ["E-handel", "Webbutik"], retail: ["Handel", "Butik"], technology: ["Digital", "Teknik", "IT"],
      professionalServices: ["Redovisning", "Revision"], consulting: ["Konsult", "Rådgivning"], construction: ["Bygg", "El", "Snickeri"],
      manufacturing: ["Mekaniska", "Industri"], printing: ["Tryck", "Tryckeri"], design: ["Design", "Studio"],
      logistics: ["Transport", "Logistik"], hospitality: ["Bageri", "Kafé", "Kök"], health: ["Hälsa", "Fysio", "Frisör"],
      realEstate: ["Fastigheter"], localServices: ["Städ", "Bilverkstad", "Service"], other: ["Holding", "Invest"],
    },
    legalForms: [{ code: "AB", name: "AB", weight: 75 }, { code: "EF", name: "Enskild firma", weight: 20 }, { code: "HB", name: "HB", weight: 5 }],
    cities: [
      { city: "Stockholm", postalCode: "111 22", region: "Stockholms län" }, { city: "Göteborg", postalCode: "411 03", region: "Västra Götaland" },
      { city: "Malmö", postalCode: "211 20", region: "Skåne" }, { city: "Uppsala", postalCode: "753 20", region: "Uppsala län" },
      { city: "Västerås", postalCode: "722 11", region: "Västmanland" }, { city: "Umeå", postalCode: "903 26", region: "Västerbotten" },
      { city: "Linköping", postalCode: "582 24", region: "Östergötland" },
    ],
    streets: ["Storgatan", "Kungsgatan", "Drottninggatan", "Hamngatan", "Parkvägen", "Industrivägen"],
    firstNames: ["Elsa", "Oscar", "Alva", "Lucas", "Maja", "William", "Ebba", "Hugo", "Astrid", "Viktor"],
    lastNames: ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Lindqvist", "Berg", "Holm", "Sjöberg", "Lund"],
    directorRoles: ["VD", "Styrelseordförande"],
    phone: (n) => `+46 ${digits(n, 2)} ${digits(n, 3)} ${digits(n, 2)} ${digits(n, 2)}`,
    registrationNumber: (n) => `559${digits(n, 3)}-${digits(n, 4)}`,
    dailyRange: [2, 6],
    activeStatus: "Active",
  },
  DK: {
    roots: ["Nordlys", "Bølgebryder", "Havhøj", "Bøgeskov", "Solsiden", "Klitgaard", "Vestkysten", "Ådalen", "Fyrtårn", "Lyngbakken", "Strandhuse", "Egelund"],
    words: {
      ecommerce: ["Webshop", "Netbutik"], retail: ["Handel", "Butik"], technology: ["Digital", "Teknologi", "IT"],
      professionalServices: ["Regnskab", "Revision"], consulting: ["Rådgivning", "Konsulent"], construction: ["Byg", "El", "Tømrer"],
      manufacturing: ["Maskinfabrik", "Industri"], printing: ["Tryk", "Trykkeri"], design: ["Design", "Studio"],
      logistics: ["Transport", "Logistik"], hospitality: ["Bageri", "Café", "Køkken"], health: ["Sundhed", "Fysioterapi", "Frisør"],
      realEstate: ["Ejendomme"], localServices: ["Rengøring", "Autoværksted", "Service"], other: ["Holding", "Invest"],
    },
    legalForms: [{ code: "ApS", name: "ApS", weight: 70 }, { code: "IVS", name: "Enkeltmandsvirksomhed", weight: 22 }, { code: "A/S", name: "A/S", weight: 8 }],
    cities: [
      { city: "København", postalCode: "1050", region: "Hovedstaden" }, { city: "Aarhus", postalCode: "8000", region: "Midtjylland" },
      { city: "Odense", postalCode: "5000", region: "Syddanmark" }, { city: "Aalborg", postalCode: "9000", region: "Nordjylland" },
      { city: "Esbjerg", postalCode: "6700", region: "Syddanmark" }, { city: "Roskilde", postalCode: "4000", region: "Sjælland" },
    ],
    streets: ["Østergade", "Vestergade", "Strandvejen", "Havnegade", "Parkvej", "Industrivej"],
    firstNames: ["Freja", "Mads", "Ida", "Frederik", "Emma", "Mathias", "Clara", "Oliver", "Laura", "Anton"],
    lastNames: ["Nielsen", "Jensen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sørensen", "Rasmussen", "Holm"],
    directorRoles: ["Direktør", "Bestyrelsesformand"],
    phone: (n) => `+45 ${digits(n, 2)} ${digits(n, 2)} ${digits(n, 2)} ${digits(n, 2)}`,
    registrationNumber: (n) => `4${digits(n, 7)}`,
    dailyRange: [1, 4],
    activeStatus: "Active",
  },
  FI: {
    roots: ["Revontuli", "Kuusikko", "Merituuli", "Koivula", "Aurinkoranta", "Järvelä", "Länsiranta", "Tunturi", "Kallio", "Saaristo", "Metsälä", "Ilta"],
    words: {
      ecommerce: ["Verkkokauppa"], retail: ["Kauppa", "Myymälä"], technology: ["Digital", "Tech", "Data"],
      professionalServices: ["Tilitoimisto", "Tilintarkastus"], consulting: ["Konsultointi", "Neuvonta"], construction: ["Rakennus", "Sähkö", "Remontti"],
      manufacturing: ["Konepaja", "Teollisuus"], printing: ["Paino"], design: ["Design", "Studio"],
      logistics: ["Kuljetus", "Logistiikka"], hospitality: ["Leipomo", "Kahvila", "Keittiö"], health: ["Terveys", "Fysioterapia", "Parturi"],
      realEstate: ["Kiinteistöt"], localServices: ["Siivous", "Autokorjaamo", "Palvelu"], other: ["Holding", "Invest"],
    },
    legalForms: [{ code: "Oy", name: "Oy", weight: 75 }, { code: "Tmi", name: "Toiminimi", weight: 22 }, { code: "Ky", name: "Ky", weight: 3 }],
    cities: [
      { city: "Helsinki", postalCode: "00100", region: "Uusimaa" }, { city: "Espoo", postalCode: "02100", region: "Uusimaa" },
      { city: "Tampere", postalCode: "33100", region: "Pirkanmaa" }, { city: "Turku", postalCode: "20100", region: "Varsinais-Suomi" },
      { city: "Oulu", postalCode: "90100", region: "Pohjois-Pohjanmaa" }, { city: "Jyväskylä", postalCode: "40100", region: "Keski-Suomi" },
    ],
    streets: ["Kauppakatu", "Rantakatu", "Puistotie", "Teollisuustie", "Asemakatu", "Koulukatu"],
    firstNames: ["Aino", "Eero", "Helmi", "Onni", "Venla", "Leo", "Siiri", "Elias", "Lilja", "Väinö"],
    lastNames: ["Korhonen", "Virtanen", "Mäkinen", "Nieminen", "Mäkelä", "Hämäläinen", "Laine", "Heikkinen", "Koskinen", "Järvinen"],
    directorRoles: ["Toimitusjohtaja", "Hallituksen puheenjohtaja"],
    phone: (n) => `+358 ${digits(n, 2)} ${digits(n, 3)} ${digits(n, 4)}`,
    registrationNumber: (n) => `3${digits(n, 6)}-${digits(n, 1)}`,
    dailyRange: [1, 4],
    activeStatus: "Active",
  },
  DE: {
    roots: ["Nordlicht", "Bergblick", "Rheinwerk", "Lindenhof", "Sonnenfeld", "Eichenwald", "Elbufer", "Alpenrot", "Isartal", "Hansewerk", "Wiesengrund", "Spreetal", "Mainblick", "Brückenstein"],
    words: {
      ecommerce: ["Onlinehandel", "Webshop"], retail: ["Handel", "Laden"], technology: ["Digital", "Software", "IT-Systeme"],
      professionalServices: ["Steuerberatung", "Buchhaltung"], consulting: ["Beratung", "Consulting"], construction: ["Bau", "Elektrotechnik", "Haustechnik"],
      manufacturing: ["Maschinenbau", "Metallbau"], printing: ["Druck", "Druckerei"], design: ["Design", "Studio"],
      logistics: ["Logistik", "Spedition"], hospitality: ["Bäckerei", "Café", "Gastro"], health: ["Physiotherapie", "Praxis", "Friseur"],
      realEstate: ["Immobilien"], localServices: ["Gebäudereinigung", "Kfz-Werkstatt", "Service"], other: ["Holding", "Beteiligungen"],
    },
    legalForms: [{ code: "GmbH", name: "GmbH", weight: 60 }, { code: "UG", name: "UG (haftungsbeschränkt)", weight: 25 }, { code: "e.K.", name: "e.K.", weight: 10 }, { code: "GbR", name: "GbR", weight: 5 }],
    cities: [
      { city: "Berlin", postalCode: "10115", region: "Berlin" }, { city: "Hamburg", postalCode: "20095", region: "Hamburg" },
      { city: "München", postalCode: "80331", region: "Bayern" }, { city: "Köln", postalCode: "50667", region: "Nordrhein-Westfalen" },
      { city: "Frankfurt am Main", postalCode: "60311", region: "Hessen" }, { city: "Stuttgart", postalCode: "70173", region: "Baden-Württemberg" },
      { city: "Leipzig", postalCode: "04109", region: "Sachsen" }, { city: "Düsseldorf", postalCode: "40213", region: "Nordrhein-Westfalen" },
    ],
    streets: ["Hauptstraße", "Bahnhofstraße", "Gartenstraße", "Schulstraße", "Industriestraße", "Lindenallee"],
    firstNames: ["Lena", "Jonas", "Hannah", "Felix", "Mia", "Lukas", "Emilia", "Paul", "Clara", "Maximilian"],
    lastNames: ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Hoffmann", "Schulz"],
    directorRoles: ["Geschäftsführer/in", "Prokurist/in"],
    phone: (n) => `+49 ${digits(n, 3)} ${digits(n, 7)}`,
    registrationNumber: (n) => `HRB ${digits(n, 6).replace(/^0/, "1")}`,
    dailyRange: [3, 8],
    activeStatus: "Active",
  },
  FR: {
    roots: ["Aurore", "Montclair", "Belle Rive", "Les Tilleuls", "Soleil d'Or", "Val Fleuri", "Côte Ouest", "Mistral", "Lumière", "Pont Neuf", "Clairefontaine", "Bois Joli", "Rivage"],
    words: {
      ecommerce: ["E-commerce", "Boutique en ligne"], retail: ["Commerce", "Boutique"], technology: ["Digital", "Numérique", "Informatique"],
      professionalServices: ["Expertise Comptable", "Gestion"], consulting: ["Conseil", "Consulting"], construction: ["Bâtiment", "Électricité", "Rénovation"],
      manufacturing: ["Mécanique", "Industrie"], printing: ["Imprimerie", "Impression"], design: ["Design", "Studio"],
      logistics: ["Transports", "Logistique"], hospitality: ["Boulangerie", "Café", "Traiteur"], health: ["Santé", "Kiné", "Coiffure"],
      realEstate: ["Immobilier"], localServices: ["Nettoyage", "Garage", "Services"], other: ["Holding", "Participations"],
    },
    legalForms: [{ code: "SAS", name: "SAS", weight: 45 }, { code: "SASU", name: "SASU", weight: 25 }, { code: "SARL", name: "SARL", weight: 20 }, { code: "EI", name: "EI", weight: 10 }],
    cities: [
      { city: "Paris", postalCode: "75002", region: "Île-de-France" }, { city: "Lyon", postalCode: "69002", region: "Auvergne-Rhône-Alpes" },
      { city: "Marseille", postalCode: "13001", region: "Provence-Alpes-Côte d'Azur" }, { city: "Toulouse", postalCode: "31000", region: "Occitanie" },
      { city: "Nantes", postalCode: "44000", region: "Pays de la Loire" }, { city: "Bordeaux", postalCode: "33000", region: "Nouvelle-Aquitaine" },
      { city: "Lille", postalCode: "59000", region: "Hauts-de-France" }, { city: "Strasbourg", postalCode: "67000", region: "Grand Est" },
    ],
    streets: ["Rue de la République", "Avenue Victor Hugo", "Rue du Commerce", "Boulevard Pasteur", "Rue des Lilas", "Avenue Jean Jaurès"],
    firstNames: ["Camille", "Louis", "Chloé", "Hugo", "Léa", "Jules", "Manon", "Arthur", "Inès", "Gabriel"],
    lastNames: ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau"],
    directorRoles: ["Président(e)", "Gérant(e)"],
    phone: (n) => `+33 ${1 + Math.floor(n() * 5)} ${digits(n, 2)} ${digits(n, 2)} ${digits(n, 2)} ${digits(n, 2)}`,
    registrationNumber: (n) => `9${digits(n, 8)}`,
    dailyRange: [3, 8],
    activeStatus: "Active",
  },
  GB: {
    roots: ["Northlight", "Thistle", "Harbourside", "Oakfield", "Brightwater", "Ashdown", "Westgate", "Riverside", "Kingsway", "Hawthorn", "Greystone", "Meadowbank", "Saltmarsh", "Elmstead"],
    words: BASE_WORDS_EN,
    legalForms: [{ code: "Ltd", name: "Ltd", weight: 88 }, { code: "LLP", name: "LLP", weight: 7 }, { code: "PLC", name: "PLC", weight: 5 }],
    cities: [
      { city: "London", postalCode: "EC2A 4NE", region: "Greater London" }, { city: "Manchester", postalCode: "M1 1AE", region: "Greater Manchester" },
      { city: "Birmingham", postalCode: "B1 1BB", region: "West Midlands" }, { city: "Leeds", postalCode: "LS1 4AP", region: "West Yorkshire" },
      { city: "Bristol", postalCode: "BS1 4DJ", region: "Bristol" }, { city: "Edinburgh", postalCode: "EH1 1YZ", region: "Scotland" },
      { city: "Glasgow", postalCode: "G1 1XQ", region: "Scotland" }, { city: "Cardiff", postalCode: "CF10 1EP", region: "Wales" },
    ],
    streets: ["High Street", "Station Road", "Church Lane", "Victoria Road", "Mill Lane", "Park Avenue"],
    firstNames: ["Olivia", "Harry", "Amelia", "George", "Isla", "Jack", "Ava", "Oliver", "Freya", "Charlie"],
    lastNames: ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Evans", "Thomas", "Roberts", "Walker"],
    directorRoles: ["Director", "Company Secretary"],
    phone: (n) => `+44 ${digits(n, 4)} ${digits(n, 6)}`,
    registrationNumber: (n) => `1${digits(n, 7)}`,
    dailyRange: [3, 8],
    activeStatus: "Active",
  },
};

/** Weighted NACE pool skewed toward the SME sectors ExploreTechify serves. */
export const NACE_POOL: { code: string; description: string; weight: number }[] = [
  { code: "47.910", description: "Retail sale via mail order houses or via Internet", weight: 8 },
  { code: "47.710", description: "Retail sale of clothing in specialised stores", weight: 3 },
  { code: "46.900", description: "Non-specialised wholesale trade", weight: 3 },
  { code: "62.010", description: "Computer programming activities", weight: 8 },
  { code: "62.020", description: "Computer consultancy activities", weight: 5 },
  { code: "70.220", description: "Business and other management consultancy activities", weight: 8 },
  { code: "69.201", description: "Accounting and bookkeeping", weight: 4 },
  { code: "71.121", description: "Engineering activities and related technical consultancy", weight: 3 },
  { code: "73.110", description: "Advertising agencies", weight: 3 },
  { code: "78.100", description: "Activities of employment placement agencies", weight: 2 },
  { code: "41.200", description: "Construction of residential and non-residential buildings", weight: 6 },
  { code: "43.210", description: "Electrical installation", weight: 4 },
  { code: "43.320", description: "Joinery installation", weight: 3 },
  { code: "25.620", description: "Machining", weight: 2 },
  { code: "10.710", description: "Manufacture of bread; fresh pastry goods and cakes", weight: 2 },
  { code: "18.120", description: "Other printing", weight: 2 },
  { code: "74.100", description: "Specialised design activities", weight: 4 },
  { code: "49.410", description: "Freight transport by road", weight: 3 },
  { code: "52.290", description: "Other transportation support activities", weight: 2 },
  { code: "56.101", description: "Restaurants and mobile food service activities", weight: 4 },
  { code: "55.101", description: "Hotels and similar accommodation", weight: 1 },
  { code: "86.909", description: "Other human health activities", weight: 2 },
  { code: "96.020", description: "Hairdressing and other beauty treatment", weight: 3 },
  { code: "68.209", description: "Renting and operating of own or leased real estate", weight: 3 },
  { code: "81.210", description: "General cleaning of buildings", weight: 2 },
  { code: "45.200", description: "Maintenance and repair of motor vehicles", weight: 2 },
  { code: "64.200", description: "Activities of holding companies", weight: 3 },
];
