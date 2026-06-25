// ISO 3166-1 alpha-2 country code -> [name, continent]. Continents:
// AF Africa · AS Asia · EU Europe · NA North America · SA South America
// OC Oceania · AN Antarctica
const C = {
  AD: ['Andorra', 'EU'], AE: ['United Arab Emirates', 'AS'], AF: ['Afghanistan', 'AS'],
  AG: ['Antigua & Barbuda', 'NA'], AI: ['Anguilla', 'NA'], AL: ['Albania', 'EU'],
  AM: ['Armenia', 'AS'], AO: ['Angola', 'AF'], AQ: ['Antarctica', 'AN'],
  AR: ['Argentina', 'SA'], AS: ['American Samoa', 'OC'], AT: ['Austria', 'EU'],
  AU: ['Australia', 'OC'], AW: ['Aruba', 'NA'], AX: ['Åland Islands', 'EU'],
  AZ: ['Azerbaijan', 'AS'], BA: ['Bosnia & Herzegovina', 'EU'], BB: ['Barbados', 'NA'],
  BD: ['Bangladesh', 'AS'], BE: ['Belgium', 'EU'], BF: ['Burkina Faso', 'AF'],
  BG: ['Bulgaria', 'EU'], BH: ['Bahrain', 'AS'], BI: ['Burundi', 'AF'],
  BJ: ['Benin', 'AF'], BL: ['St. Barthélemy', 'NA'], BM: ['Bermuda', 'NA'],
  BN: ['Brunei', 'AS'], BO: ['Bolivia', 'SA'], BQ: ['Caribbean Netherlands', 'NA'],
  BR: ['Brazil', 'SA'], BS: ['Bahamas', 'NA'], BT: ['Bhutan', 'AS'],
  BW: ['Botswana', 'AF'], BY: ['Belarus', 'EU'], BZ: ['Belize', 'NA'],
  CA: ['Canada', 'NA'], CD: ['DR Congo', 'AF'], CF: ['Central African Rep.', 'AF'],
  CG: ['Congo', 'AF'], CH: ['Switzerland', 'EU'], CI: ['Côte d’Ivoire', 'AF'],
  CK: ['Cook Islands', 'OC'], CL: ['Chile', 'SA'], CM: ['Cameroon', 'AF'],
  CN: ['China', 'AS'], CO: ['Colombia', 'SA'], CR: ['Costa Rica', 'NA'],
  CU: ['Cuba', 'NA'], CV: ['Cape Verde', 'AF'], CW: ['Curaçao', 'NA'],
  CY: ['Cyprus', 'AS'], CZ: ['Czechia', 'EU'], DE: ['Germany', 'EU'],
  DJ: ['Djibouti', 'AF'], DK: ['Denmark', 'EU'], DM: ['Dominica', 'NA'],
  DO: ['Dominican Rep.', 'NA'], DZ: ['Algeria', 'AF'], EC: ['Ecuador', 'SA'],
  EE: ['Estonia', 'EU'], EG: ['Egypt', 'AF'], EH: ['Western Sahara', 'AF'],
  ER: ['Eritrea', 'AF'], ES: ['Spain', 'EU'], ET: ['Ethiopia', 'AF'],
  FI: ['Finland', 'EU'], FJ: ['Fiji', 'OC'], FK: ['Falkland Islands', 'SA'],
  FM: ['Micronesia', 'OC'], FO: ['Faroe Islands', 'EU'], FR: ['France', 'EU'],
  GA: ['Gabon', 'AF'], GB: ['United Kingdom', 'EU'], GD: ['Grenada', 'NA'],
  GE: ['Georgia', 'AS'], GF: ['French Guiana', 'SA'], GG: ['Guernsey', 'EU'],
  GH: ['Ghana', 'AF'], GI: ['Gibraltar', 'EU'], GL: ['Greenland', 'NA'],
  GM: ['Gambia', 'AF'], GN: ['Guinea', 'AF'], GP: ['Guadeloupe', 'NA'],
  GQ: ['Equatorial Guinea', 'AF'], GR: ['Greece', 'EU'], GT: ['Guatemala', 'NA'],
  GU: ['Guam', 'OC'], GW: ['Guinea-Bissau', 'AF'], GY: ['Guyana', 'SA'],
  HK: ['Hong Kong', 'AS'], HN: ['Honduras', 'NA'], HR: ['Croatia', 'EU'],
  HT: ['Haiti', 'NA'], HU: ['Hungary', 'EU'], ID: ['Indonesia', 'AS'],
  IE: ['Ireland', 'EU'], IL: ['Israel', 'AS'], IM: ['Isle of Man', 'EU'],
  IN: ['India', 'AS'], IQ: ['Iraq', 'AS'], IR: ['Iran', 'AS'],
  IS: ['Iceland', 'EU'], IT: ['Italy', 'EU'], JE: ['Jersey', 'EU'],
  JM: ['Jamaica', 'NA'], JO: ['Jordan', 'AS'], JP: ['Japan', 'AS'],
  KE: ['Kenya', 'AF'], KG: ['Kyrgyzstan', 'AS'], KH: ['Cambodia', 'AS'],
  KI: ['Kiribati', 'OC'], KM: ['Comoros', 'AF'], KN: ['St. Kitts & Nevis', 'NA'],
  KP: ['North Korea', 'AS'], KR: ['South Korea', 'AS'], KW: ['Kuwait', 'AS'],
  KY: ['Cayman Islands', 'NA'], KZ: ['Kazakhstan', 'AS'], LA: ['Laos', 'AS'],
  LB: ['Lebanon', 'AS'], LC: ['St. Lucia', 'NA'], LI: ['Liechtenstein', 'EU'],
  LK: ['Sri Lanka', 'AS'], LR: ['Liberia', 'AF'], LS: ['Lesotho', 'AF'],
  LT: ['Lithuania', 'EU'], LU: ['Luxembourg', 'EU'], LV: ['Latvia', 'EU'],
  LY: ['Libya', 'AF'], MA: ['Morocco', 'AF'], MC: ['Monaco', 'EU'],
  MD: ['Moldova', 'EU'], ME: ['Montenegro', 'EU'], MF: ['St. Martin', 'NA'],
  MG: ['Madagascar', 'AF'], MH: ['Marshall Islands', 'OC'], MK: ['North Macedonia', 'EU'],
  ML: ['Mali', 'AF'], MM: ['Myanmar', 'AS'], MN: ['Mongolia', 'AS'],
  MO: ['Macau', 'AS'], MP: ['Northern Mariana Is.', 'OC'], MQ: ['Martinique', 'NA'],
  MR: ['Mauritania', 'AF'], MS: ['Montserrat', 'NA'], MT: ['Malta', 'EU'],
  MU: ['Mauritius', 'AF'], MV: ['Maldives', 'AS'], MW: ['Malawi', 'AF'],
  MX: ['Mexico', 'NA'], MY: ['Malaysia', 'AS'], MZ: ['Mozambique', 'AF'],
  NA: ['Namibia', 'AF'], NC: ['New Caledonia', 'OC'], NE: ['Niger', 'AF'],
  NF: ['Norfolk Island', 'OC'], NG: ['Nigeria', 'AF'], NI: ['Nicaragua', 'NA'],
  NL: ['Netherlands', 'EU'], NO: ['Norway', 'EU'], NP: ['Nepal', 'AS'],
  NR: ['Nauru', 'OC'], NU: ['Niue', 'OC'], NZ: ['New Zealand', 'OC'],
  OM: ['Oman', 'AS'], PA: ['Panama', 'NA'], PE: ['Peru', 'SA'],
  PF: ['French Polynesia', 'OC'], PG: ['Papua New Guinea', 'OC'], PH: ['Philippines', 'AS'],
  PK: ['Pakistan', 'AS'], PL: ['Poland', 'EU'], PM: ['St. Pierre & Miquelon', 'NA'],
  PR: ['Puerto Rico', 'NA'], PS: ['Palestine', 'AS'], PT: ['Portugal', 'EU'],
  PW: ['Palau', 'OC'], PY: ['Paraguay', 'SA'], QA: ['Qatar', 'AS'],
  RE: ['Réunion', 'AF'], RO: ['Romania', 'EU'], RS: ['Serbia', 'EU'],
  RU: ['Russia', 'EU'], RW: ['Rwanda', 'AF'], SA: ['Saudi Arabia', 'AS'],
  SB: ['Solomon Islands', 'OC'], SC: ['Seychelles', 'AF'], SD: ['Sudan', 'AF'],
  SE: ['Sweden', 'EU'], SG: ['Singapore', 'AS'], SI: ['Slovenia', 'EU'],
  SK: ['Slovakia', 'EU'], SL: ['Sierra Leone', 'AF'], SM: ['San Marino', 'EU'],
  SN: ['Senegal', 'AF'], SO: ['Somalia', 'AF'], SR: ['Suriname', 'SA'],
  SS: ['South Sudan', 'AF'], ST: ['São Tomé & Príncipe', 'AF'], SV: ['El Salvador', 'NA'],
  SX: ['Sint Maarten', 'NA'], SY: ['Syria', 'AS'], SZ: ['Eswatini', 'AF'],
  TC: ['Turks & Caicos Is.', 'NA'], TD: ['Chad', 'AF'], TG: ['Togo', 'AF'],
  TH: ['Thailand', 'AS'], TJ: ['Tajikistan', 'AS'], TL: ['Timor-Leste', 'AS'],
  TM: ['Turkmenistan', 'AS'], TN: ['Tunisia', 'AF'], TO: ['Tonga', 'OC'],
  TR: ['Turkey', 'AS'], TT: ['Trinidad & Tobago', 'NA'], TV: ['Tuvalu', 'OC'],
  TW: ['Taiwan', 'AS'], TZ: ['Tanzania', 'AF'], UA: ['Ukraine', 'EU'],
  UG: ['Uganda', 'AF'], US: ['United States', 'NA'], UY: ['Uruguay', 'SA'],
  UZ: ['Uzbekistan', 'AS'], VA: ['Vatican City', 'EU'], VC: ['St. Vincent', 'NA'],
  VE: ['Venezuela', 'SA'], VG: ['British Virgin Is.', 'NA'], VI: ['U.S. Virgin Is.', 'NA'],
  VN: ['Vietnam', 'AS'], VU: ['Vanuatu', 'OC'], WF: ['Wallis & Futuna', 'OC'],
  WS: ['Samoa', 'OC'], XK: ['Kosovo', 'EU'], YE: ['Yemen', 'AS'],
  YT: ['Mayotte', 'AF'], ZA: ['South Africa', 'AF'], ZM: ['Zambia', 'AF'],
  ZW: ['Zimbabwe', 'AF']
};

export const COUNTRIES = Object.fromEntries(
  Object.entries(C).map(([code, [name, continent]]) => [code, { name, continent }])
);

export const CONTINENTS = [
  { code: 'EU', name: 'Europe' },
  { code: 'NA', name: 'North America' },
  { code: 'SA', name: 'South America' },
  { code: 'AS', name: 'Asia' },
  { code: 'AF', name: 'Africa' },
  { code: 'OC', name: 'Oceania' }
];

export function countriesInContinent(code) {
  return Object.keys(COUNTRIES).filter(c => COUNTRIES[c].continent === code);
}

export const countryName = (code) => COUNTRIES[code]?.name || code;
export const continentOf = (code) => COUNTRIES[code]?.continent || null;
