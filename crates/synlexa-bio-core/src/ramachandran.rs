//! Backbone Ramachandran (phi, psi) dihedral analysis, secondary structure
//! classification, Ramachandran region evaluation, and Ca-Ca contact map summary.

use crate::json::{opt_f64, JsonValue};
use crate::structure::{parse_structure, Residue, SourceTypeHint, StructureFormat};
use crate::superpose::select_chain_index;
use crate::{CoreError, RUO_NOTICE};

pub const MAX_PEPTIDE_BOND_ANGSTROM: f64 = 2.5;
pub const CONTACT_CUTOFF_ANGSTROM: f64 = 8.0;
pub const MIN_CONTACT_SEQ_SEPARATION: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecondaryStructure {
    Helix,
    Sheet,
    Loop,
}

impl SecondaryStructure {
    pub fn as_str(self) -> &'static str {
        match self {
            SecondaryStructure::Helix => "helix",
            SecondaryStructure::Sheet => "sheet",
            SecondaryStructure::Loop => "loop",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RamachandranRegion {
    Favored,
    Allowed,
    Outlier,
    Terminal,
}

impl RamachandranRegion {
    pub fn as_str(self) -> &'static str {
        match self {
            RamachandranRegion::Favored => "favored",
            RamachandranRegion::Allowed => "allowed",
            RamachandranRegion::Outlier => "outlier",
            RamachandranRegion::Terminal => "terminal",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RamachandranResidue {
    pub seq_id: i32,
    pub ins_code: String,
    pub res_name3: String,
    pub res_code1: char,
    pub phi_deg: Option<f64>,
    pub psi_deg: Option<f64>,
    pub secondary: SecondaryStructure,
    pub region: RamachandranRegion,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SecondaryCounts {
    pub helix: usize,
    pub sheet: usize,
    pub loop_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RegionCounts {
    pub favored: usize,
    pub allowed: usize,
    pub outlier: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RamachandranResult {
    pub chain_id: String,
    pub auth_chain_id: String,
    pub format: StructureFormat,
    pub residues: Vec<RamachandranResidue>,
    pub secondary_counts: SecondaryCounts,
    pub region_counts: RegionCounts,
    pub contact_pairs: Vec<(i32, i32, f64)>,
}

impl RamachandranResult {
    pub fn to_json(&self) -> JsonValue {
        let residues_json: Vec<JsonValue> = self
            .residues
            .iter()
            .map(|r| {
                JsonValue::object(vec![
                    ("seqId", JsonValue::Number(r.seq_id as f64)),
                    ("insCode", JsonValue::String(r.ins_code.clone())),
                    ("resName3", JsonValue::String(r.res_name3.clone())),
                    ("resCode1", JsonValue::String(r.res_code1.to_string())),
                    ("phiDeg", opt_f64(r.phi_deg)),
                    ("psiDeg", opt_f64(r.psi_deg)),
                    (
                        "secondary",
                        JsonValue::String(r.secondary.as_str().to_string()),
                    ),
                    ("region", JsonValue::String(r.region.as_str().to_string())),
                ])
            })
            .collect();

        let contacts_json: Vec<JsonValue> = self
            .contact_pairs
            .iter()
            .map(|(i_seq, j_seq, dist)| {
                JsonValue::Array(vec![
                    JsonValue::Number(*i_seq as f64),
                    JsonValue::Number(*j_seq as f64),
                    JsonValue::Number(*dist),
                ])
            })
            .collect();

        JsonValue::object(vec![
            ("ruoNotice", JsonValue::String(RUO_NOTICE.to_string())),
            ("chainId", JsonValue::String(self.chain_id.clone())),
            ("authChainId", JsonValue::String(self.auth_chain_id.clone())),
            (
                "format",
                JsonValue::String(self.format.as_str().to_string()),
            ),
            (
                "residueCount",
                JsonValue::Number(self.residues.len() as f64),
            ),
            ("residues", JsonValue::Array(residues_json)),
            (
                "secondaryCounts",
                JsonValue::object(vec![
                    ("helix", JsonValue::Number(self.secondary_counts.helix as f64)),
                    ("sheet", JsonValue::Number(self.secondary_counts.sheet as f64)),
                    (
                        "loop",
                        JsonValue::Number(self.secondary_counts.loop_count as f64),
                    ),
                ]),
            ),
            (
                "regionCounts",
                JsonValue::object(vec![
                    (
                        "favored",
                        JsonValue::Number(self.region_counts.favored as f64),
                    ),
                    (
                        "allowed",
                        JsonValue::Number(self.region_counts.allowed as f64),
                    ),
                    (
                        "outlier",
                        JsonValue::Number(self.region_counts.outlier as f64),
                    ),
                ]),
            ),
            ("contactPairs", JsonValue::Array(contacts_json)),
        ])
    }
}

fn sub3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn norm3(a: [f64; 3]) -> f64 {
    dot3(a, a).sqrt()
}

fn dist3(a: [f64; 3], b: [f64; 3]) -> f64 {
    norm3(sub3(a, b))
}

/// IUPAC-IUB dihedral angle in degrees in [-180, 180] for points p0-p1-p2-p3.
pub fn dihedral_deg(p0: [f64; 3], p1: [f64; 3], p2: [f64; 3], p3: [f64; 3]) -> Option<f64> {
    let u1 = sub3(p1, p0);
    let u2 = sub3(p2, p1);
    let u3 = sub3(p3, p2);
    let u2_len = norm3(u2);
    if u2_len < 1e-9 {
        return None;
    }
    let n1 = cross3(u1, u2);
    let n2 = cross3(u2, u3);
    if norm3(n1) < 1e-9 || norm3(n2) < 1e-9 {
        return None;
    }
    let u2_hat = [u2[0] / u2_len, u2[1] / u2_len, u2[2] / u2_len];
    let x = dot3(n1, n2);
    let y = dot3(cross3(n1, n2), u2_hat);
    let deg = y.atan2(x).to_degrees();
    if !deg.is_finite() {
        return None;
    }
    Some(if deg == 0.0 { 0.0 } else { deg })
}

fn backbone_atom_xyz(res: &Residue, atom_name: &str) -> Option<[f64; 3]> {
    if atom_name == "CA" {
        if let Some(ca) = res.ca {
            return Some(ca);
        }
    }
    res.atoms
        .iter()
        .find(|a| a.name == atom_name)
        .map(|a| a.xyz)
}

pub fn classify_secondary(phi: Option<f64>, psi: Option<f64>) -> SecondaryStructure {
    let (Some(phi), Some(psi)) = (phi, psi) else {
        return SecondaryStructure::Loop;
    };
    // Right-handed alpha / 3_10 helix basin
    if (-120.0..=-25.0).contains(&phi) && (-75.0..=10.0).contains(&psi) {
        return SecondaryStructure::Helix;
    }
    // Extended beta-sheet / strand basin (with periodic wrap below -155 deg)
    if (-180.0..=-50.0).contains(&phi) && (psi >= 85.0 || psi <= -155.0) {
        return SecondaryStructure::Sheet;
    }
    SecondaryStructure::Loop
}

pub fn classify_region(
    res_name3: &str,
    phi: Option<f64>,
    psi: Option<f64>,
) -> RamachandranRegion {
    let (Some(phi), Some(psi)) = (phi, psi) else {
        return RamachandranRegion::Terminal;
    };

    let upper = res_name3.trim().to_ascii_uppercase();
    if upper == "GLY" {
        let favored = ((-125.0..=-40.0).contains(&phi) && (-65.0..=40.0).contains(&psi))
            || ((40.0..=125.0).contains(&phi) && (-40.0..=65.0).contains(&psi))
            || (phi.abs() >= 55.0 && psi.abs() >= 120.0)
            || ((-180.0..=-55.0).contains(&phi) && (90.0..=125.0).contains(&psi))
            || ((55.0..=180.0).contains(&phi) && (-125.0..=-90.0).contains(&psi));
        if favored {
            return RamachandranRegion::Favored;
        }
        let allowed = phi.abs() >= 28.0 || psi.abs() >= 140.0;
        return if allowed {
            RamachandranRegion::Allowed
        } else {
            RamachandranRegion::Outlier
        };
    }

    if upper == "PRO" {
        let favored = (-98.0..=-40.0).contains(&phi)
            && ((-60.0..=10.0).contains(&psi)
                || (100.0..=180.0).contains(&psi)
                || (-180.0..=-162.0).contains(&psi));
        if favored {
            return RamachandranRegion::Favored;
        }
        let allowed = ((-118.0..=-28.0).contains(&phi)
            && ((-80.0..=28.0).contains(&psi)
                || (70.0..=180.0).contains(&psi)
                || (-180.0..=-145.0).contains(&psi)))
            || ((-90.0..=-45.0).contains(&phi) && (28.0..=70.0).contains(&psi));
        return if allowed {
            RamachandranRegion::Allowed
        } else {
            RamachandranRegion::Outlier
        };
    }

    // General residues (non-GLY, non-PRO)
    let favored = ((-118.0..=-38.0).contains(&phi) && (-65.0..=8.0).contains(&psi))
        || ((-170.0..=-48.0).contains(&phi)
            && ((90.0..=180.0).contains(&psi) || (-180.0..=-158.0).contains(&psi)))
        || ((38.0..=85.0).contains(&phi) && (10.0..=68.0).contains(&psi));
    if favored {
        return RamachandranRegion::Favored;
    }

    let allowed = ((-165.0..=-22.0).contains(&phi) && (-85.0..=35.0).contains(&psi))
        || ((-150.0..=-45.0).contains(&phi) && (35.0..=90.0).contains(&psi))
        || ((-180.0..=-35.0).contains(&phi)
            && ((70.0..=180.0).contains(&psi) || (-180.0..=-135.0).contains(&psi)))
        || ((160.0..=180.0).contains(&phi)
            && ((100.0..=180.0).contains(&psi) || (-180.0..=-150.0).contains(&psi)))
        || ((22.0..=115.0).contains(&phi) && (-25.0..=95.0).contains(&psi))
        || ((55.0..=95.0).contains(&phi) && (-85.0..=-35.0).contains(&psi))
        || ((-100.0..=-55.0).contains(&phi) && (-150.0..=-110.0).contains(&psi));

    if allowed {
        RamachandranRegion::Allowed
    } else {
        RamachandranRegion::Outlier
    }
}

/// Parse structure, select polymer chain (enforcing ERR_AMBIGUOUS_CHAIN if >1 chain
/// and `chain_id` omitted), compute backbone phi/psi dihedral angles, classify
/// secondary structure and Ramachandran regions, and compute Ca-Ca contact pairs.
pub fn analyze_ramachandran(
    content: &str,
    chain_id: Option<&str>,
) -> Result<RamachandranResult, CoreError> {
    let parsed = parse_structure(content, SourceTypeHint::Auto)?;
    let chain_idx = select_chain_index(&parsed, chain_id, "ramachandran")?;
    let chain = &parsed.chains[chain_idx];

    struct Backbone<'a> {
        res: &'a Residue,
        n: Option<[f64; 3]>,
        ca: Option<[f64; 3]>,
        c: Option<[f64; 3]>,
    }

    let backbone: Vec<Backbone<'_>> = chain
        .residues
        .iter()
        .map(|r| Backbone {
            res: r,
            n: backbone_atom_xyz(r, "N"),
            ca: backbone_atom_xyz(r, "CA"),
            c: backbone_atom_xyz(r, "C"),
        })
        .collect();

    let n_res = backbone.len();
    let mut residues = Vec::with_capacity(n_res);
    let mut secondary_counts = SecondaryCounts::default();
    let mut region_counts = RegionCounts::default();

    for i in 0..n_res {
        let cur = &backbone[i];

        let phi_deg = if i > 0 {
            match (backbone[i - 1].c, cur.n, cur.ca, cur.c) {
                (Some(c_prev), Some(n_i), Some(ca_i), Some(c_i))
                    if dist3(c_prev, n_i) <= MAX_PEPTIDE_BOND_ANGSTROM =>
                {
                    dihedral_deg(c_prev, n_i, ca_i, c_i)
                }
                _ => None,
            }
        } else {
            None
        };

        let psi_deg = if i + 1 < n_res {
            match (cur.n, cur.ca, cur.c, backbone[i + 1].n) {
                (Some(n_i), Some(ca_i), Some(c_i), Some(n_next))
                    if dist3(c_i, n_next) <= MAX_PEPTIDE_BOND_ANGSTROM =>
                {
                    dihedral_deg(n_i, ca_i, c_i, n_next)
                }
                _ => None,
            }
        } else {
            None
        };

        let secondary = classify_secondary(phi_deg, psi_deg);
        match secondary {
            SecondaryStructure::Helix => secondary_counts.helix += 1,
            SecondaryStructure::Sheet => secondary_counts.sheet += 1,
            SecondaryStructure::Loop => secondary_counts.loop_count += 1,
        }

        let region = classify_region(&cur.res.res_name3, phi_deg, psi_deg);
        match region {
            RamachandranRegion::Favored => region_counts.favored += 1,
            RamachandranRegion::Allowed => region_counts.allowed += 1,
            RamachandranRegion::Outlier => region_counts.outlier += 1,
            RamachandranRegion::Terminal => {}
        }

        residues.push(RamachandranResidue {
            seq_id: cur.res.seq_id,
            ins_code: cur.res.ins_code.clone(),
            res_name3: cur.res.res_name3.clone(),
            res_code1: cur.res.res_code1,
            phi_deg,
            psi_deg,
            secondary,
            region,
        });
    }

    // Compact Ca-Ca contact map for non-adjacent |i - j| >= 4 within 8.0 A
    let mut contact_pairs: Vec<(i32, i32, f64)> = Vec::new();
    for i in 0..n_res {
        let Some(ca_i) = backbone[i].ca else {
            continue;
        };
        for j in (i + MIN_CONTACT_SEQ_SEPARATION)..n_res {
            let Some(ca_j) = backbone[j].ca else {
                continue;
            };
            let d = dist3(ca_i, ca_j);
            if d <= CONTACT_CUTOFF_ANGSTROM {
                contact_pairs.push((backbone[i].res.seq_id, backbone[j].res.seq_id, d));
            }
        }
    }

    Ok(RamachandranResult {
        chain_id: chain.chain_id.clone(),
        auth_chain_id: chain.auth_chain_id.clone(),
        format: parsed.format,
        residues,
        secondary_counts,
        region_counts,
        contact_pairs,
    })
}
