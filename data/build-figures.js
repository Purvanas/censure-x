'use strict';

// Transforme le CSV officiel du X Transparency Center en JSON exploitable.
//
// Source : https://transparency.x.com/content/dam/transparency-twitter/download/
//          2020-jul-dec/Twitter_Transparency-Removal_Requests_Jul-Dec-2020.csv
//
// C'est le dernier export par pays que X ait publié en fichier : depuis, le
// Transparency Center ne rend ses chiffres que dans une interface JavaScript,
// sans téléchargement par pays. Les données couvrent donc 2012 → 2020 et le
// site le dit à chaque fois qu'il les affiche.

const fs = require('fs');
const path = require('path');

const CSV = path.join(__dirname, 'x-removal-requests-2012-2020.csv');
const OUT = path.join(__dirname, 'figures.json');

// Découpage CSV minimal — le fichier n'a ni guillemets ni virgules dans les champs,
// mais on gère les guillemets au cas où X changerait son export.
function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (v) => (v === 'NULL' || v === '' || v == null ? null : Number(v));

// Le CSV nomme les pays en anglais ; on veut des codes ISO pour recoller au reste.
const ISO = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Andorra': 'AD', 'Angola': 'AO',
  'Argentina': 'AR', 'Armenia': 'AM', 'Australia': 'AU', 'Austria': 'AT', 'Azerbaijan': 'AZ',
  'Bahamas': 'BS', 'Bahrain': 'BH', 'Bangladesh': 'BD', 'Barbados': 'BB', 'Belarus': 'BY',
  'Belgium': 'BE', 'Belize': 'BZ', 'Bermuda': 'BM', 'Bolivia': 'BO',
  'Bosnia and Herzegovina': 'BA', 'Bosnia And Herzegovina': 'BA',
  'Botswana': 'BW', 'Brazil': 'BR', 'Brunei': 'BN',
  'Bulgaria': 'BG', 'Cambodia': 'KH', 'Cameroon': 'CM', 'Canada': 'CA', 'Chile': 'CL',
  'China': 'CN', 'Colombia': 'CO', 'Costa Rica': 'CR', 'Croatia': 'HR', 'Cyprus': 'CY',
  'Czech Republic': 'CZ', 'Czechia': 'CZ', 'Denmark': 'DK', 'Dominican Republic': 'DO',
  'Ecuador': 'EC', 'Egypt': 'EG', 'El Salvador': 'SV', 'Estonia': 'EE', 'Ethiopia': 'ET',
  'Finland': 'FI', 'France': 'FR', 'Georgia': 'GE', 'Germany': 'DE', 'Ghana': 'GH',
  'Gibraltar': 'GI', 'Greece': 'GR', 'Guatemala': 'GT', 'Haiti': 'HT', 'Honduras': 'HN',
  'Hong Kong': 'HK', 'Hong Kong SAR': 'HK', 'Hungary': 'HU', 'Iceland': 'IS',
  'India': 'IN', 'Indonesia': 'ID',
  // X annote d'un ** les pays où il est lui-même bloqué : les demandes existent,
  // le service n'y est pas accessible. On garde le pays, on perd l'astérisque.
  'Iran': 'IR', 'Iran**': 'IR', 'China**': 'CN',
  'Iraq': 'IQ', 'Ireland': 'IE', 'Israel': 'IL', 'Italy': 'IT',
  'Jamaica': 'JM', 'Japan': 'JP', 'Jordan': 'JO', 'Kazakhstan': 'KZ', 'Kenya': 'KE',
  'Kosovo': 'XK', 'Kuwait': 'KW', 'Kyrgyzstan': 'KG', 'Latvia': 'LV', 'Lebanon': 'LB',
  'Liechtenstein': 'LI', 'Lithuania': 'LT', 'Luxembourg': 'LU', 'Macao': 'MO',
  'Malawi': 'MW', 'Malaysia': 'MY', 'Maldives': 'MV', 'Malta': 'MT', 'Mauritius': 'MU',
  'Mexico': 'MX', 'Moldova': 'MD', 'Monaco': 'MC', 'Mongolia': 'MN', 'Montenegro': 'ME',
  'Morocco': 'MA', 'Myanmar': 'MM', 'Namibia': 'NA', 'Nepal': 'NP', 'Netherlands': 'NL',
  'New Zealand': 'NZ', 'Nicaragua': 'NI', 'Nigeria': 'NG', 'North Macedonia': 'MK',
  'Macedonia': 'MK', 'Norway': 'NO', 'Oman': 'OM', 'Pakistan': 'PK', 'Palestine': 'PS',
  'Palestinian Territories': 'PS', 'Panama': 'PA', 'Paraguay': 'PY', 'Peru': 'PE',
  'Philippines': 'PH', 'Poland': 'PL', 'Portugal': 'PT', 'Qatar': 'QA', 'Romania': 'RO',
  'Russia': 'RU', 'Rwanda': 'RW', 'Saudi Arabia': 'SA', 'Senegal': 'SN', 'Serbia': 'RS',
  'Singapore': 'SG', 'Slovakia': 'SK', 'Slovenia': 'SI', 'South Africa': 'ZA',
  'South Korea': 'KR', 'Korea, Republic of': 'KR', 'South Sudan': 'SS', 'Spain': 'ES',
  'Sri Lanka': 'LK', 'Sudan': 'SD', 'Sweden': 'SE', 'Switzerland': 'CH', 'Taiwan': 'TW',
  'Tanzania': 'TZ', 'Thailand': 'TH', 'Trinidad and Tobago': 'TT', 'Tunisia': 'TN',
  'Turkey': 'TR', 'Türkiye': 'TR', 'Turkmenistan': 'TM', 'Uganda': 'UG', 'Ukraine': 'UA',
  'United Arab Emirates': 'AE', 'United Kingdom': 'GB', 'United States': 'US',
  'Uruguay': 'UY', 'Uzbekistan': 'UZ', 'Venezuela': 'VE', 'Vietnam': 'VN', 'Yemen': 'YE',
  'Zambia': 'ZM', 'Zimbabwe': 'ZW',
};

// Le CSV contient des lignes « Worldwide », mais elles sont vides (des zéros et des
// NULL). On calcule donc le total mondial en additionnant les pays plutôt que de le
// lire — et on le range sous un code réservé pour pouvoir situer chaque pays.
const WORLD = 'WW';

function main() {
  const lines = fs.readFileSync(CSV, 'utf8').split(/\r?\n/);

  // Le fichier contient deux tables l'une sous l'autre, séparées par un titre.
  const start2 = lines.findIndex((l) => l.startsWith('Table 2/2'));
  const table1 = lines.slice(2, start2 === -1 ? lines.length : start2);

  const byCountry = new Map();
  const unknown = new Set();

  for (const line of table1) {
    if (!line || !/^\d{4}-/.test(line)) continue;
    const f = parseLine(line);
    const [period, country] = f;
    if (country === 'Worldwide') continue;
    const code = ISO[country];
    if (!code) { unknown.add(country); continue; }

    if (!byCountry.has(code)) byCountry.set(code, { code, name: country, periods: [] });
    byCountry.get(code).periods.push({
      period,                                    // début de semestre, ex. 2020-07-01
      courtOrders: num(f[2]),                    // décisions de justice
      otherDemands: num(f[3]),                   // demandes administratives / police
      requests: num(f[4]),                       // total des demandes légales
      complianceRate: num(f[7]),                 // part des demandes suivies d'effet
      accountsSpecified: num(f[10]),             // comptes visés
      accountsWithheld: num(f[11]),              // comptes rendus invisibles dans le pays
      tweetsWithheld: num(f[12]),                // posts rendus invisibles dans le pays
      accountsTOS: num(f[15]),                   // comptes sanctionnés au titre des règles de X
    });
  }

  const countries = {};
  for (const [code, rec] of byCountry) {
    rec.periods.sort((a, b) => a.period.localeCompare(b.period));
    const sum = (k) => rec.periods.reduce((t, p) => t + (p[k] || 0), 0);
    const last = rec.periods[rec.periods.length - 1];
    countries[code] = {
      code,
      nameEn: rec.name,
      periods: rec.periods,
      total: {
        requests: sum('requests'),
        accountsSpecified: sum('accountsSpecified'),
        accountsWithheld: sum('accountsWithheld'),
        tweetsWithheld: sum('tweetsWithheld'),
        accountsTOS: sum('accountsTOS'),
      },
      last,
      firstPeriod: rec.periods[0].period,
      lastPeriod: last.period,
    };
  }

  // Total mondial reconstitué : somme des pays, par semestre puis sur la période.
  const worldPeriods = new Map();
  for (const rec of Object.values(countries)) {
    for (const p of rec.periods) {
      if (!worldPeriods.has(p.period)) {
        worldPeriods.set(p.period, {
          period: p.period, courtOrders: 0, otherDemands: 0, requests: 0,
          complianceRate: null, accountsSpecified: 0, accountsWithheld: 0,
          tweetsWithheld: 0, accountsTOS: 0,
        });
      }
      const w = worldPeriods.get(p.period);
      for (const k of ['courtOrders', 'otherDemands', 'requests', 'accountsSpecified',
        'accountsWithheld', 'tweetsWithheld', 'accountsTOS']) w[k] += p[k] || 0;
    }
  }
  const wp = [...worldPeriods.values()].sort((a, b) => a.period.localeCompare(b.period));
  countries[WORLD] = {
    code: WORLD,
    nameEn: 'Worldwide',
    periods: wp,
    total: ['requests', 'accountsSpecified', 'accountsWithheld', 'tweetsWithheld', 'accountsTOS']
      .reduce((t, k) => (t[k] = wp.reduce((s, p) => s + p[k], 0), t), {}),
    last: wp[wp.length - 1],
    firstPeriod: wp[0].period,
    lastPeriod: wp[wp.length - 1].period,
    reconstructed: true,
  };

  const out = {
    source: {
      title: 'X Transparency Center — Removal Requests (export CSV)',
      url: 'https://transparency.x.com/en/reports/removal-requests',
      file: 'Twitter_Transparency-Removal_Requests_Jul-Dec-2020.csv',
      coverage: '1er janvier 2012 → 31 décembre 2020',
      note: "Dernier export par pays publié par X sous forme de fichier. Les semestres "
        + "suivants ne sont plus téléchargeables : X ne les rend que dans une interface "
        + "JavaScript, sans jeu de données par pays.",
    },
    generatedFrom: 'data/x-removal-requests-2012-2020.csv',
    countries,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const n = Object.keys(countries).length;
  console.log(`figures.json écrit — ${n} pays, ${table1.filter((l) => /^\d{4}-/.test(l)).length} lignes`);
  if (unknown.size) console.warn('Pays sans code ISO (ignorés) :', [...unknown].join(', '));
}

main();
