//! Peptide & protein engineering calculator: point mutations, sequence slicing,
//! monoisotopic & average MW, Henderson-Hasselbalch pI & pH 0..14 titration,
//! Kyte-Doolittle GRAVY & profile, 280 nm extinction coefficient, steric volume
//! delta, and optional 3D <5.0 A local contact shell.

use std::collections::HashMap;

use crate::json::JsonValue;
use crate::structure::{parse_structure, SourceTypeHint};
use crate::superpose::select_chain_index;
use crate::{CoreError, RUO_NOTICE};

#[derive(Debug, Clone)]
pub struct PeptideDescriptors {
    pub sequence: String,
    pub length: usize,
    pub mw_average_da: f64,
    pub mw_monoisotopic_da: f64,
    pub pi: f64,
    pub charge_at_ph74: f64,
    pub gravy: f64,
    pub extinction_reduced: f64,
    pub extinction_cystine: f64,
    pub steric_volume_a3: f64,
    pub aromatic_fraction: f64,
    pub hydrophobic_fraction: f64,
}

impl PeptideDescriptors {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::object(vec![
            ("sequence", JsonValue::String(self.sequence.clone())),
            ("length", JsonValue::Number(self.length as f64)),
            ("mwAverageDa", JsonValue::Number(self.mw_average_da)),
            (
                "mwMonoisotopicDa",
                JsonValue::Number(self.mw_monoisotopic_da),
            ),
            ("pi", JsonValue::Number(self.pi)),
            ("chargeAtPh74", JsonValue::Number(self.charge_at_ph74)),
            ("gravy", JsonValue::Number(self.gravy)),
            (
                "extinctionReduced",
                JsonValue::Number(self.extinction_reduced),
            ),
            (
                "extinctionCystine",
                JsonValue::Number(self.extinction_cystine),
            ),
            ("stericVolumeA3", JsonValue::Number(self.steric_volume_a3)),
            (
                "aromaticFraction",
                JsonValue::Number(self.aromatic_fraction),
            ),
            (
                "hydrophobicFraction",
                JsonValue::Number(self.hydrophobic_fraction),
            ),
        ])
    }
}

#[derive(Debug, Clone)]
pub struct AppliedMutation {
    pub notation: String,
    pub pos: usize,
    pub from: char,
    pub to: char,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct TitrationPoint {
    pub ph: f64,
    pub wt_charge: f64,
    pub eng_charge: f64,
}

#[derive(Debug, Clone)]
pub struct GravyPoint {
    pub index: usize,
    pub res: char,
    pub wt_score: f64,
    pub eng_score: f64,
}

#[derive(Debug, Clone)]
pub struct LocalContact {
    pub seq_id: i32,
    pub res_name3: String,
    pub distance_angstrom: f64,
}

#[derive(Debug, Clone)]
pub struct PeptideAnalysis {
    pub wild_type: PeptideDescriptors,
    pub engineered: PeptideDescriptors,
    pub titration_curve: Vec<TitrationPoint>,
    pub gravy_profile: Vec<GravyPoint>,
    pub applied_mutations: Vec<AppliedMutation>,
    pub local_3d_contacts: Vec<LocalContact>,
}

impl PeptideAnalysis {
    pub fn to_json(&self) -> JsonValue {
        let deltas = JsonValue::object(vec![
            (
                "mwAverageDa",
                JsonValue::Number(self.engineered.mw_average_da - self.wild_type.mw_average_da),
            ),
            (
                "mwMonoisotopicDa",
                JsonValue::Number(
                    self.engineered.mw_monoisotopic_da - self.wild_type.mw_monoisotopic_da,
                ),
            ),
            ("pi", JsonValue::Number(self.engineered.pi - self.wild_type.pi)),
            (
                "chargeAtPh74",
                JsonValue::Number(self.engineered.charge_at_ph74 - self.wild_type.charge_at_ph74),
            ),
            (
                "gravy",
                JsonValue::Number(self.engineered.gravy - self.wild_type.gravy),
            ),
            (
                "stericVolumeDeltaA3",
                JsonValue::Number(
                    self.engineered.steric_volume_a3 - self.wild_type.steric_volume_a3,
                ),
            ),
        ]);

        let titration_json: Vec<JsonValue> = self
            .titration_curve
            .iter()
            .map(|t| {
                JsonValue::object(vec![
                    ("ph", JsonValue::Number(t.ph)),
                    ("wtCharge", JsonValue::Number(t.wt_charge)),
                    ("engCharge", JsonValue::Number(t.eng_charge)),
                ])
            })
            .collect();

        let gravy_json: Vec<JsonValue> = self
            .gravy_profile
            .iter()
            .map(|g| {
                JsonValue::object(vec![
                    ("index", JsonValue::Number(g.index as f64)),
                    ("res", JsonValue::String(g.res.to_string())),
                    ("wtScore", JsonValue::Number(g.wt_score)),
                    ("engScore", JsonValue::Number(g.eng_score)),
                ])
            })
            .collect();

        let muts_json: Vec<JsonValue> = self
            .applied_mutations
            .iter()
            .map(|m| {
                JsonValue::object(vec![
                    ("notation", JsonValue::String(m.notation.clone())),
                    ("pos", JsonValue::Number(m.pos as f64)),
                    ("from", JsonValue::String(m.from.to_string())),
                    ("to", JsonValue::String(m.to.to_string())),
                    (
                        "notes",
                        JsonValue::Array(
                            m.notes
                                .iter()
                                .map(|n| JsonValue::String(n.clone()))
                                .collect(),
                        ),
                    ),
                ])
            })
            .collect();

        let contacts_json: Vec<JsonValue> = self
            .local_3d_contacts
            .iter()
            .map(|c| {
                JsonValue::object(vec![
                    ("seqId", JsonValue::Number(c.seq_id as f64)),
                    ("resName3", JsonValue::String(c.res_name3.clone())),
                    ("distanceAngstrom", JsonValue::Number(c.distance_angstrom)),
                ])
            })
            .collect();

        JsonValue::object(vec![
            ("ruoNotice", JsonValue::String(RUO_NOTICE.to_string())),
            ("wildType", self.wild_type.to_json()),
            ("engineered", self.engineered.to_json()),
            ("deltas", deltas),
            ("titrationCurve", JsonValue::Array(titration_json)),
            ("gravyProfile", JsonValue::Array(gravy_json)),
            ("appliedMutations", JsonValue::Array(muts_json)),
            ("local3dContacts", JsonValue::Array(contacts_json)),
        ])
    }
}

fn aa_masses(aa: char) -> Option<(f64, f64)> {
    // (average residue mass Da, monoisotopic residue mass Da)
    Some(match aa {
        'A' => (71.0788, 71.0371138),
        'R' => (156.1875, 156.1011110),
        'N' => (114.1038, 114.0429274),
        'D' => (115.0886, 115.0269430),
        'C' => (103.1388, 103.0091845),
        'E' => (129.1155, 129.0425931),
        'Q' => (128.1307, 128.0585775),
        'G' => (57.0519, 57.0214637),
        'H' => (137.1411, 137.0589119),
        'I' => (113.1594, 113.0840640),
        'L' => (113.1594, 113.0840640),
        'K' => (128.1741, 128.0949630),
        'M' => (131.1926, 131.0404846),
        'F' => (147.1766, 147.0684139),
        'P' => (97.1167, 97.0527638),
        'S' => (87.0782, 87.0320284),
        'T' => (101.1051, 101.0476785),
        'W' => (186.2132, 186.0793130),
        'Y' => (163.1760, 163.0633285),
        'V' => (99.1326, 99.0684139),
        'U' => (150.0388, 150.9536330),
        'O' => (237.3018, 237.1477269),
        _ => return None,
    })
}

pub fn kyte_doolittle(aa: char) -> f64 {
    match aa {
        'I' => 4.5,
        'V' => 4.2,
        'L' => 3.8,
        'F' => 2.8,
        'C' => 2.5,
        'M' => 1.9,
        'A' => 1.8,
        'G' => -0.4,
        'T' => -0.7,
        'S' => -0.8,
        'W' => -0.9,
        'Y' => -1.3,
        'P' => -1.6,
        'H' => -3.2,
        'E' => -3.5,
        'Q' => -3.5,
        'D' => -3.5,
        'N' => -3.5,
        'K' => -3.9,
        'R' => -4.5,
        _ => 0.0,
    }
}

fn steric_volume_a3(aa: char) -> f64 {
    // Zamyatnin (1972) amino acid residue volumes in A^3
    match aa {
        'G' => 60.1,
        'A' => 88.6,
        'S' => 89.0,
        'C' => 108.5,
        'D' => 111.1,
        'P' => 112.7,
        'N' => 114.1,
        'T' => 116.1,
        'E' => 138.4,
        'V' => 140.0,
        'Q' => 143.8,
        'H' => 153.2,
        'M' => 162.9,
        'I' => 166.7,
        'L' => 166.7,
        'K' => 168.6,
        'R' => 173.4,
        'F' => 189.9,
        'Y' => 193.6,
        'W' => 227.8,
        _ => 110.0,
    }
}

/// Net charge at a given pH via Henderson-Hasselbalch using EMBOSS/ExPASy pKa constants.
pub fn net_charge_at_ph(seq: &str, ph: f64) -> f64 {
    if seq.is_empty() {
        return 0.0;
    }
    let mut n_d = 0.0;
    let mut n_e = 0.0;
    let mut n_c = 0.0;
    let mut n_y = 0.0;
    let mut n_h = 0.0;
    let mut n_k = 0.0;
    let mut n_r = 0.0;

    for ch in seq.chars() {
        match ch {
            'D' => n_d += 1.0,
            'E' => n_e += 1.0,
            'C' => n_c += 1.0,
            'Y' => n_y += 1.0,
            'H' => n_h += 1.0,
            'K' => n_k += 1.0,
            'R' => n_r += 1.0,
            _ => {}
        }
    }

    let pos = 1.0 / (1.0 + 10_f64.powf(ph - 8.6)) // N-terminus
        + n_h / (1.0 + 10_f64.powf(ph - 6.5))
        + n_k / (1.0 + 10_f64.powf(ph - 10.8))
        + n_r / (1.0 + 10_f64.powf(ph - 12.5));

    let neg = 1.0 / (1.0 + 10_f64.powf(3.6 - ph)) // C-terminus
        + n_d / (1.0 + 10_f64.powf(3.9 - ph))
        + n_e / (1.0 + 10_f64.powf(4.1 - ph))
        + n_c / (1.0 + 10_f64.powf(8.5 - ph))
        + n_y / (1.0 + 10_f64.powf(10.1 - ph));

    pos - neg
}

pub fn compute_pi(seq: &str) -> f64 {
    if seq.is_empty() {
        return 7.0;
    }
    let mut lo = 0.0_f64;
    let mut hi = 14.0_f64;
    for _ in 0..64 {
        let mid = 0.5 * (lo + hi);
        let q = net_charge_at_ph(seq, mid);
        if q > 0.0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

pub fn compute_descriptors(seq: &str) -> Result<PeptideDescriptors, CoreError> {
    if seq.is_empty() {
        return Err(CoreError::new(
            "ERR_INVALID_INPUT",
            "Peptide sequence cannot be empty",
        ));
    }

    const H2O_AVG: f64 = 18.01528;
    const H2O_MONO: f64 = 18.010564684;

    let mut mw_avg = H2O_AVG;
    let mut mw_mono = H2O_MONO;
    let mut kd_sum = 0.0;
    let mut vol_sum = 0.0;
    let mut n_w = 0usize;
    let mut n_y = 0usize;
    let mut n_c = 0usize;
    let mut n_aromatic = 0usize;
    let mut n_hydrophobic = 0usize;

    let len = seq.len();
    for ch in seq.chars() {
        let (avg, mono) = aa_masses(ch).ok_or_else(|| {
            CoreError::new(
                "ERR_INVALID_INPUT",
                format!("Unsupported amino acid character '{}' in sequence", ch),
            )
        })?;
        mw_avg += avg;
        mw_mono += mono;
        kd_sum += kyte_doolittle(ch);
        vol_sum += steric_volume_a3(ch);
        match ch {
            'W' => {
                n_w += 1;
                n_aromatic += 1;
                n_hydrophobic += 1;
            }
            'Y' => {
                n_y += 1;
                n_aromatic += 1;
            }
            'F' => {
                n_aromatic += 1;
                n_hydrophobic += 1;
            }
            'C' => n_c += 1,
            'A' | 'V' | 'I' | 'L' | 'M' | 'P' => n_hydrophobic += 1,
            _ => {}
        }
    }

    let pi = compute_pi(seq);
    let charge_74 = net_charge_at_ph(seq, 7.4);
    let gravy = kd_sum / (len as f64);
    let ext_reduced = (n_w * 5500 + n_y * 1490) as f64;
    let ext_cystine = ext_reduced + ((n_c / 2) * 125) as f64;

    Ok(PeptideDescriptors {
        sequence: seq.to_string(),
        length: len,
        mw_average_da: mw_avg,
        mw_monoisotopic_da: mw_mono,
        pi,
        charge_at_ph74: charge_74,
        gravy,
        extinction_reduced: ext_reduced,
        extinction_cystine: ext_cystine,
        steric_volume_a3: vol_sum,
        aromatic_fraction: (n_aromatic as f64) / (len as f64),
        hydrophobic_fraction: (n_hydrophobic as f64) / (len as f64),
    })
}

fn parse_mutation_notation(raw: &str) -> Result<(char, usize, char), CoreError> {
    let s = raw.trim().to_ascii_uppercase();
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 3 {
        return Err(CoreError::new(
            "ERR_INVALID_INPUT",
            format!("Invalid mutation notation '{}'; expected e.g. H94A", raw),
        ));
    }
    let from = chars[0];
    let to = *chars.last().unwrap();
    let pos_str: String = chars[1..chars.len() - 1].iter().collect();
    let pos: usize = pos_str.parse().map_err(|_| {
        CoreError::new(
            "ERR_INVALID_INPUT",
            format!("Invalid residue index in mutation '{}'", raw),
        )
    })?;
    if pos == 0 || aa_masses(from).is_none() || aa_masses(to).is_none() {
        return Err(CoreError::new(
            "ERR_INVALID_INPUT",
            format!("Unsupported amino acid or 0-based position in '{}'", raw),
        ));
    }
    Ok((from, pos, to))
}

fn mutation_notes(from: char, to: char) -> Vec<String> {
    let mut notes = Vec::new();
    let d_kd = kyte_doolittle(to) - kyte_doolittle(from);
    if d_kd.abs() >= 1.0 {
        notes.push(format!(
            "Kyte-Doolittle hydropathy delta: {:+.1}",
            d_kd
        ));
    }
    let d_vol = steric_volume_a3(to) - steric_volume_a3(from);
    if d_vol.abs() >= 10.0 {
        notes.push(format!("Steric side-chain volume delta: {:+.1} A^3", d_vol));
    }
    if from == 'H' && to != 'H' {
        notes.push("Replaces imidazole ring (potential metal/proton-shuttle side chain)".to_string());
    }
    if to == 'P' && from != 'P' {
        notes.push("Introduces proline backbone dihedral constraint".to_string());
    }
    if to == 'C' && from != 'C' {
        notes.push("Introduces thiol group (potential redox/disulfide reactivity)".to_string());
    }
    if notes.is_empty() {
        notes.push(format!("Substitutes {} -> {}", from, to));
    }
    notes
}

pub fn analyze_peptide(
    raw_sequence: &str,
    mutations: &[String],
    slice_start: Option<usize>,
    slice_end: Option<usize>,
    structure_content: Option<&str>,
    chain_id: Option<&str>,
    focus_seq_id: Option<i32>,
) -> Result<PeptideAnalysis, CoreError> {
    let full_seq: String = raw_sequence
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if full_seq.is_empty() {
        return Err(CoreError::new(
            "ERR_INVALID_INPUT",
            "Peptide sequence cannot be empty",
        ));
    }

    let mut eng_chars: Vec<char> = full_seq.chars().collect();
    let mut applied = Vec::new();
    for mut_str in mutations {
        if mut_str.trim().is_empty() {
            continue;
        }
        let (from, pos, to) = parse_mutation_notation(mut_str)?;
        if pos > eng_chars.len() {
            return Err(CoreError::new(
                "ERR_INVALID_INPUT",
                format!(
                    "Mutation {} position {} exceeds sequence length {}",
                    mut_str,
                    pos,
                    eng_chars.len()
                ),
            ));
        }
        let observed = eng_chars[pos - 1];
        if observed != from {
            return Err(CoreError::new(
                "ERR_INVALID_INPUT",
                format!(
                    "Mutation {} expects '{}' at position {}, found '{}'",
                    mut_str, from, pos, observed
                ),
            ));
        }
        eng_chars[pos - 1] = to;
        applied.push(AppliedMutation {
            notation: mut_str.trim().to_ascii_uppercase(),
            pos,
            from,
            to,
            notes: mutation_notes(from, to),
        });
    }

    let start1 = slice_start.unwrap_or(1).max(1);
    let end1 = slice_end.unwrap_or(full_seq.len()).min(full_seq.len());
    if start1 > end1 || start1 > full_seq.len() {
        return Err(CoreError::new(
            "ERR_INVALID_INPUT",
            format!(
                "Invalid slice range {}..{} for sequence of length {}",
                start1,
                end1,
                full_seq.len()
            ),
        ));
    }

    let wt_slice: String = full_seq.chars().skip(start1 - 1).take(end1 - start1 + 1).collect();
    let eng_slice: String = eng_chars
        .iter()
        .skip(start1 - 1)
        .take(end1 - start1 + 1)
        .collect();

    let wild_type = compute_descriptors(&wt_slice)?;
    let engineered = compute_descriptors(&eng_slice)?;

    let mut titration_curve = Vec::with_capacity(29);
    for step in 0..=28 {
        let ph = (step as f64) * 0.5;
        titration_curve.push(TitrationPoint {
            ph,
            wt_charge: net_charge_at_ph(&wt_slice, ph),
            eng_charge: net_charge_at_ph(&eng_slice, ph),
        });
    }

    let mut gravy_profile = Vec::with_capacity(wt_slice.len());
    for (idx, (w_ch, e_ch)) in wt_slice.chars().zip(eng_slice.chars()).enumerate() {
        gravy_profile.push(GravyPoint {
            index: start1 + idx,
            res: e_ch,
            wt_score: kyte_doolittle(w_ch),
            eng_score: kyte_doolittle(e_ch),
        });
    }

    // Optional 3D <5.0 A local contact shell around focus_seq_id or first mutated residue
    let target_seq_id = focus_seq_id.or_else(|| applied.first().map(|m| m.pos as i32));
    let mut local_3d_contacts = Vec::new();
    if let (Some(content), Some(target_id)) = (structure_content, target_seq_id) {
        if !content.trim().is_empty() {
            let parsed = parse_structure(content, SourceTypeHint::Auto)?;
            let c_idx = select_chain_index(&parsed, chain_id, "peptide")?;
            let chain = &parsed.chains[c_idx];
            if let Some(center_res) = chain.residues.iter().find(|r| r.seq_id == target_id) {
                let mut min_dists: HashMap<i32, (String, f64)> = HashMap::new();
                for other in &chain.residues {
                    if other.seq_id == center_res.seq_id {
                        continue;
                    }
                    let mut best = f64::INFINITY;
                    for a1 in &center_res.atoms {
                        for a2 in &other.atoms {
                            let dx = a1.xyz[0] - a2.xyz[0];
                            let dy = a1.xyz[1] - a2.xyz[1];
                            let dz = a1.xyz[2] - a2.xyz[2];
                            let d = (dx * dx + dy * dy + dz * dz).sqrt();
                            if d < best {
                                best = d;
                            }
                        }
                    }
                    if best < 5.0 {
                        min_dists.insert(other.seq_id, (other.res_name3.clone(), best));
                    }
                }
                let mut list: Vec<LocalContact> = min_dists
                    .into_iter()
                    .map(|(seq_id, (res_name3, distance_angstrom))| LocalContact {
                        seq_id,
                        res_name3,
                        distance_angstrom,
                    })
                    .collect();
                list.sort_by(|a, b| a.distance_angstrom.total_cmp(&b.distance_angstrom));
                local_3d_contacts = list;
            }
        }
    }

    Ok(PeptideAnalysis {
        wild_type,
        engineered,
        titration_curve,
        gravy_profile,
        applied_mutations: applied,
        local_3d_contacts,
    })
}
