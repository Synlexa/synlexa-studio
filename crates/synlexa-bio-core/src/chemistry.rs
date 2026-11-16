//! Deterministic SMILES parser, molecular graph descriptor calculator
//! (formula, MW, exact mass, HBD/HBA, rotatable bonds, Ertl TPSA,
//! Wildman-Crippen cLogP, Lipinski/Veber flags), and 2D layout generator.

use std::collections::{HashMap, HashSet, VecDeque};

use crate::json::JsonValue;
use crate::{CoreError, RUO_NOTICE};

#[derive(Debug, Clone)]
pub struct MolAtom {
    pub id: usize,
    pub element: String,
    pub atomic_num: u8,
    pub aromatic: bool,
    pub formal_charge: i8,
    pub explicit_h: Option<u8>,
    pub implicit_h: u8,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone)]
pub struct MolBond {
    pub from: usize,
    pub to: usize,
    pub order: u8, // 1, 2, 3, 4 (aromatic)
    pub in_ring: bool,
}

#[derive(Debug, Clone)]
pub struct MoleculeAnalysis {
    pub name: String,
    pub smiles: String,
    pub formula: String,
    pub molecular_weight: f64,
    pub exact_mass: f64,
    pub heavy_atom_count: usize,
    pub ring_count: usize,
    pub aromatic_atom_count: usize,
    pub hbd: usize,
    pub hba: usize,
    pub rotatable_bonds: usize,
    pub tpsa: f64,
    pub crippen_logp: f64,
    pub lipinski_violations: usize,
    pub veber_compliant: bool,
    pub atoms: Vec<MolAtom>,
    pub bonds: Vec<MolBond>,
}

impl MoleculeAnalysis {
    pub fn to_json(&self) -> JsonValue {
        let atoms_json: Vec<JsonValue> = self
            .atoms
            .iter()
            .map(|a| {
                JsonValue::object(vec![
                    ("id", JsonValue::Number(a.id as f64)),
                    ("element", JsonValue::String(a.element.clone())),
                    ("charge", JsonValue::Number(a.formal_charge as f64)),
                    ("aromatic", JsonValue::Bool(a.aromatic)),
                    ("x", JsonValue::Number(a.x)),
                    ("y", JsonValue::Number(a.y)),
                ])
            })
            .collect();

        let bonds_json: Vec<JsonValue> = self
            .bonds
            .iter()
            .map(|b| {
                JsonValue::object(vec![
                    ("from", JsonValue::Number(b.from as f64)),
                    ("to", JsonValue::Number(b.to as f64)),
                    ("order", JsonValue::Number(b.order as f64)),
                ])
            })
            .collect();

        JsonValue::object(vec![
            ("ruoNotice", JsonValue::String(RUO_NOTICE.to_string())),
            ("name", JsonValue::String(self.name.clone())),
            ("smiles", JsonValue::String(self.smiles.clone())),
            ("formula", JsonValue::String(self.formula.clone())),
            ("molecularWeight", JsonValue::Number(self.molecular_weight)),
            ("exactMass", JsonValue::Number(self.exact_mass)),
            (
                "heavyAtomCount",
                JsonValue::Number(self.heavy_atom_count as f64),
            ),
            ("ringCount", JsonValue::Number(self.ring_count as f64)),
            (
                "aromaticAtomCount",
                JsonValue::Number(self.aromatic_atom_count as f64),
            ),
            ("hbd", JsonValue::Number(self.hbd as f64)),
            ("hba", JsonValue::Number(self.hba as f64)),
            (
                "rotatableBonds",
                JsonValue::Number(self.rotatable_bonds as f64),
            ),
            ("tpsa", JsonValue::Number(self.tpsa)),
            ("crippenLogP", JsonValue::Number(self.crippen_logp)),
            (
                "lipinskiViolations",
                JsonValue::Number(self.lipinski_violations as f64),
            ),
            ("veberCompliant", JsonValue::Bool(self.veber_compliant)),
            (
                "layout2d",
                JsonValue::object(vec![
                    ("atoms", JsonValue::Array(atoms_json)),
                    ("bonds", JsonValue::Array(bonds_json)),
                ]),
            ),
        ])
    }
}

fn element_info(sym: &str) -> Option<(u8, f64, f64)> {
    // (atomic_num, standard_atomic_weight, monoisotopic_exact_mass)
    Some(match sym {
        "H" => (1, 1.008, 1.007825032),
        "B" => (5, 10.81, 11.00930536),
        "C" => (6, 12.011, 12.0000000),
        "N" => (7, 14.007, 14.003074004),
        "O" => (8, 15.999, 15.994914620),
        "F" => (9, 18.998403, 18.998403163),
        "Mg" => (12, 24.305, 23.985041697),
        "P" => (15, 30.973762, 30.973761998),
        "S" => (16, 32.06, 31.972071174),
        "Cl" => (17, 35.45, 34.968852682),
        "Fe" => (26, 55.845, 55.9349363),
        "Zn" => (30, 65.38, 63.9291422),
        "Br" => (35, 79.904, 78.9183376),
        "I" => (53, 126.90447, 126.9044719),
        _ => return None,
    })
}

fn default_valence(elem: &str, valence_sum: f64, aromatic: bool, charge: i8) -> u8 {
    if aromatic {
        let target: f64 = match elem {
            "C" => 4.0,
            "N" => 3.0,
            "O" | "S" => 2.0,
            "P" => 3.0,
            _ => valence_sum,
        };
        let eff = (target + (charge as f64)).max(valence_sum);
        return (eff - valence_sum).round().max(0.0) as u8;
    }
    let valences: &[f64] = match elem {
        "B" => &[3.0],
        "C" => &[4.0],
        "N" => &[3.0],
        "O" => &[2.0],
        "P" => &[3.0, 5.0],
        "S" => &[2.0, 4.0, 6.0],
        "F" | "Cl" | "Br" | "I" => &[1.0],
        "Zn" | "Mg" | "Fe" => &[0.0],
        _ => &[0.0],
    };
    let adj = valence_sum - (charge as f64);
    for &v in valences {
        if adj <= v + 1e-6 {
            return (v - adj).round().max(0.0) as u8;
        }
    }
    0
}

pub fn analyze_molecule_smiles(
    name: Option<&str>,
    raw_smiles: &str,
) -> Result<MoleculeAnalysis, CoreError> {
    let smiles = raw_smiles.trim();
    if smiles.is_empty() {
        return Err(CoreError::new(
            "ERR_INVALID_SMILES",
            "SMILES string cannot be empty",
        ));
    }

    let bytes = smiles.as_bytes();
    let len = bytes.len();
    let mut pos = 0usize;

    let mut atoms: Vec<MolAtom> = Vec::new();
    let mut bonds: Vec<MolBond> = Vec::new();
    let mut adj: Vec<Vec<(usize, u8)>> = Vec::new();
    let mut branch_stack: Vec<Option<usize>> = Vec::new();
    let mut ring_closures: HashMap<u16, (usize, Option<u8>)> = HashMap::new();

    let mut prev_atom: Option<usize> = None;
    let mut pending_bond: Option<u8> = None;

    while pos < len {
        let b = bytes[pos];
        match b {
            b'-' => {
                if pending_bond.is_some() {
                    return Err(CoreError::new("ERR_INVALID_SMILES", "Duplicate bond symbol"));
                }
                pending_bond = Some(1);
                pos += 1;
            }
            b'=' => {
                if pending_bond.is_some() {
                    return Err(CoreError::new("ERR_INVALID_SMILES", "Duplicate bond symbol"));
                }
                pending_bond = Some(2);
                pos += 1;
            }
            b'#' => {
                if pending_bond.is_some() {
                    return Err(CoreError::new("ERR_INVALID_SMILES", "Duplicate bond symbol"));
                }
                pending_bond = Some(3);
                pos += 1;
            }
            b':' => {
                if pending_bond.is_some() {
                    return Err(CoreError::new("ERR_INVALID_SMILES", "Duplicate bond symbol"));
                }
                pending_bond = Some(4);
                pos += 1;
            }
            b'/' | b'\\' => {
                if pending_bond.is_none() {
                    pending_bond = Some(1);
                }
                pos += 1;
            }
            b'.' => {
                if pending_bond.is_some() {
                    return Err(CoreError::new(
                        "ERR_INVALID_SMILES",
                        "Bond before fragment separator '.'",
                    ));
                }
                prev_atom = None;
                pos += 1;
            }
            b'(' => {
                if prev_atom.is_none() {
                    return Err(CoreError::new(
                        "ERR_INVALID_SMILES",
                        "Branch '(' without preceding atom",
                    ));
                }
                branch_stack.push(prev_atom);
                pos += 1;
            }
            b')' => {
                if pending_bond.is_some() {
                    return Err(CoreError::new(
                        "ERR_INVALID_SMILES",
                        "Dangling bond before ')'",
                    ));
                }
                prev_atom = branch_stack.pop().ok_or_else(|| {
                    CoreError::new("ERR_INVALID_SMILES", "Unmatched closing parenthesis ')'")
                })?;
                pos += 1;
            }
            b'0'..=b'9' | b'%' => {
                let cur = prev_atom.ok_or_else(|| {
                    CoreError::new("ERR_INVALID_SMILES", "Ring digit without preceding atom")
                })?;
                let ring_num: u16 = if b == b'%' {
                    if pos + 2 >= len
                        || !bytes[pos + 1].is_ascii_digit()
                        || !bytes[pos + 2].is_ascii_digit()
                    {
                        return Err(CoreError::new(
                            "ERR_INVALID_SMILES",
                            "Invalid %NN ring closure",
                        ));
                    }
                    let n = ((bytes[pos + 1] - b'0') as u16) * 10
                        + ((bytes[pos + 2] - b'0') as u16);
                    pos += 3;
                    n
                } else {
                    pos += 1;
                    (b - b'0') as u16
                };
                if let Some((partner, open_bond)) = ring_closures.remove(&ring_num) {
                    if partner == cur {
                        return Err(CoreError::new(
                            "ERR_INVALID_SMILES",
                            "Self-loop ring bond is invalid",
                        ));
                    }
                    let order = match (open_bond, pending_bond) {
                        (Some(o1), Some(o2)) if o1 != o2 => {
                            return Err(CoreError::new(
                                "ERR_INVALID_SMILES",
                                format!("Conflicting bond orders on ring closure {}", ring_num),
                            ));
                        }
                        (Some(o), _) | (_, Some(o)) => o,
                        (None, None) => {
                            if atoms[partner].aromatic && atoms[cur].aromatic {
                                4
                            } else {
                                1
                            }
                        }
                    };
                    add_bond(&mut bonds, &mut adj, partner, cur, order)?;
                } else {
                    ring_closures.insert(ring_num, (cur, pending_bond));
                }
                pending_bond = None;
            }
            b'[' => {
                let end = smiles[pos + 1..].find(']').map(|k| pos + 1 + k).ok_or_else(
                    || CoreError::new("ERR_INVALID_SMILES", "Unclosed bracket atom '['"),
                )?;
                let inner = &smiles[pos + 1..end];
                let atom = parse_bracket_atom(atoms.len(), inner)?;
                let idx = atoms.len();
                atoms.push(atom);
                adj.push(Vec::new());
                if let Some(prev) = prev_atom {
                    let order = pending_bond.unwrap_or_else(|| {
                        if atoms[prev].aromatic && atoms[idx].aromatic {
                            4
                        } else {
                            1
                        }
                    });
                    add_bond(&mut bonds, &mut adj, prev, idx, order)?;
                }
                prev_atom = Some(idx);
                pending_bond = None;
                pos = end + 1;
            }
            _ => {
                let (atom, consumed) = parse_organic_atom(atoms.len(), &smiles[pos..])?;
                let idx = atoms.len();
                atoms.push(atom);
                adj.push(Vec::new());
                if let Some(prev) = prev_atom {
                    let order = pending_bond.unwrap_or_else(|| {
                        if atoms[prev].aromatic && atoms[idx].aromatic {
                            4
                        } else {
                            1
                        }
                    });
                    add_bond(&mut bonds, &mut adj, prev, idx, order)?;
                }
                prev_atom = Some(idx);
                pending_bond = None;
                pos += consumed;
            }
        }
    }

    if !branch_stack.is_empty() {
        return Err(CoreError::new(
            "ERR_INVALID_SMILES",
            "Unclosed branch parenthesis '('",
        ));
    }
    if !ring_closures.is_empty() {
        return Err(CoreError::new(
            "ERR_INVALID_SMILES",
            "Unclosed ring closure digit in SMILES",
        ));
    }
    if pending_bond.is_some() {
        return Err(CoreError::new(
            "ERR_INVALID_SMILES",
            "Trailing bond symbol at end of SMILES",
        ));
    }
    if atoms.is_empty() {
        return Err(CoreError::new(
            "ERR_INVALID_SMILES",
            "No atoms parsed from SMILES",
        ));
    }

    // Compute implicit H and ring membership
    for (idx, atom) in atoms.iter_mut().enumerate() {
        if let Some(eh) = atom.explicit_h {
            atom.implicit_h = eh;
        } else {
            let mut val_sum = 0.0_f64;
            for &(_, ord) in &adj[idx] {
                val_sum += if ord == 4 { 1.5 } else { ord as f64 };
            }
            atom.implicit_h =
                default_valence(&atom.element, val_sum, atom.aromatic, atom.formal_charge);
        }
    }

    let components = count_components(atoms.len(), &adj);
    let ring_count = (bonds.len() + components).saturating_sub(atoms.len());
    mark_ring_bonds(&mut bonds, atoms.len());

    // Formula, MW, exact mass
    let mut elem_counts: HashMap<String, usize> = HashMap::new();
    let mut total_h = 0usize;
    let mut mw = 0.0_f64;
    let mut exact_mass = 0.0_f64;
    let mut aromatic_atom_count = 0usize;
    let mut hbd = 0usize;
    let mut hba = 0usize;

    let (_, h_mw, h_exact) = element_info("H").unwrap();

    for atom in &atoms {
        *elem_counts.entry(atom.element.clone()).or_insert(0) += 1;
        let h_cnt = atom.implicit_h as usize;
        total_h += h_cnt;
        let (_, a_mw, a_exact) = element_info(&atom.element).unwrap();
        mw += a_mw + (h_cnt as f64) * h_mw;
        exact_mass += a_exact + (h_cnt as f64) * h_exact;
        if atom.aromatic {
            aromatic_atom_count += 1;
        }
        if (atom.element == "N" || atom.element == "O") && h_cnt > 0 {
            hbd += 1;
        }
        if atom.element == "N" || atom.element == "O" {
            hba += 1;
        }
    }
    if total_h > 0 {
        *elem_counts.entry("H".to_string()).or_insert(0) += total_h;
    }

    let formula = format_hill_formula(&elem_counts);
    let rotatable_bonds = count_rotatable_bonds(&atoms, &bonds, &adj);
    let tpsa = compute_ertl_tpsa(&atoms, &adj);
    let crippen_logp = compute_wildman_crippen_logp(&atoms, &adj);

    let mut lipinski_violations = 0usize;
    if mw > 500.0 {
        lipinski_violations += 1;
    }
    if crippen_logp > 5.0 {
        lipinski_violations += 1;
    }
    if hbd > 5 {
        lipinski_violations += 1;
    }
    if hba > 10 {
        lipinski_violations += 1;
    }
    let veber_compliant = rotatable_bonds <= 10 && tpsa <= 140.0;

    // Generate deterministic 2D coordinates
    generate_layout_2d(&mut atoms, &bonds, &adj);

    Ok(MoleculeAnalysis {
        name: name.unwrap_or("Molecule").to_string(),
        smiles: smiles.to_string(),
        formula,
        molecular_weight: mw,
        exact_mass,
        heavy_atom_count: atoms.len(),
        ring_count,
        aromatic_atom_count,
        hbd,
        hba,
        rotatable_bonds,
        tpsa,
        crippen_logp,
        lipinski_violations,
        veber_compliant,
        atoms,
        bonds,
    })
}

fn add_bond(
    bonds: &mut Vec<MolBond>,
    adj: &mut [Vec<(usize, u8)>],
    u: usize,
    v: usize,
    order: u8,
) -> Result<(), CoreError> {
    if adj[u].iter().any(|&(nbr, _)| nbr == v) {
        return Err(CoreError::new(
            "ERR_INVALID_SMILES",
            "Duplicate bond between same pair of atoms",
        ));
    }
    let (a, b) = if u < v { (u, v) } else { (v, u) };
    bonds.push(MolBond {
        from: a,
        to: b,
        order,
        in_ring: false,
    });
    adj[u].push((v, order));
    adj[v].push((u, order));
    Ok(())
}

fn parse_organic_atom(id: usize, s: &str) -> Result<(MolAtom, usize), CoreError> {
    let bytes = s.as_bytes();
    let (elem, aromatic, consumed) = if s.starts_with("Cl") {
        ("Cl", false, 2)
    } else if s.starts_with("Br") {
        ("Br", false, 2)
    } else {
        match bytes[0] {
            b'B' => ("B", false, 1),
            b'C' => ("C", false, 1),
            b'N' => ("N", false, 1),
            b'O' => ("O", false, 1),
            b'P' => ("P", false, 1),
            b'S' => ("S", false, 1),
            b'F' => ("F", false, 1),
            b'I' => ("I", false, 1),
            b'b' => ("B", true, 1),
            b'c' => ("C", true, 1),
            b'n' => ("N", true, 1),
            b'o' => ("O", true, 1),
            b'p' => ("P", true, 1),
            b's' => ("S", true, 1),
            other => {
                return Err(CoreError::new(
                    "ERR_INVALID_SMILES",
                    format!("Unexpected character '{}' in SMILES", other as char),
                ));
            }
        }
    };
    let (atomic_num, _, _) = element_info(elem).unwrap();
    Ok((
        MolAtom {
            id,
            element: elem.to_string(),
            atomic_num,
            aromatic,
            formal_charge: 0,
            explicit_h: None,
            implicit_h: 0,
            x: 0.0,
            y: 0.0,
        },
        consumed,
    ))
}

fn parse_bracket_atom(id: usize, inner: &str) -> Result<MolAtom, CoreError> {
    if inner.is_empty() {
        return Err(CoreError::new("ERR_INVALID_SMILES", "Empty bracket atom []"));
    }
    let bytes = inner.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i >= bytes.len() {
        return Err(CoreError::new(
            "ERR_INVALID_SMILES",
            format!("Missing element symbol in [{}]", inner),
        ));
    }

    let first = bytes[i] as char;
    let aromatic = first.is_ascii_lowercase();
    let elem = if i + 1 < bytes.len() && bytes[i + 1].is_ascii_lowercase() && first.is_ascii_uppercase() {
        let two = format!("{}{}", first, bytes[i + 1] as char);
        if element_info(&two).is_some() {
            i += 2;
            two
        } else {
            i += 1;
            first.to_ascii_uppercase().to_string()
        }
    } else {
        i += 1;
        first.to_ascii_uppercase().to_string()
    };

    let (atomic_num, _, _) = element_info(&elem).ok_or_else(|| {
        CoreError::new(
            "ERR_INVALID_SMILES",
            format!("Unsupported element '{}' in [{}]", elem, inner),
        )
    })?;

    // Skip optional chiral tag '@' or '@@'
    while i < bytes.len() && bytes[i] == b'@' {
        i += 1;
    }

    let mut explicit_h: Option<u8> = Some(0);
    if i < bytes.len() && bytes[i] == b'H' {
        i += 1;
        let mut h_cnt = 0u8;
        let mut has_digit = false;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            has_digit = true;
            h_cnt = h_cnt.saturating_mul(10).saturating_add(bytes[i] - b'0');
            i += 1;
        }
        explicit_h = Some(if has_digit { h_cnt } else { 1 });
    }

    let mut charge: i8 = 0;
    if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
        let sign: i8 = if bytes[i] == b'+' { 1 } else { -1 };
        i += 1;
        if i < bytes.len() && bytes[i].is_ascii_digit() {
            let mut mag = 0i8;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                mag = mag.saturating_mul(10).saturating_add((bytes[i] - b'0') as i8);
                i += 1;
            }
            charge = sign * mag;
        } else {
            let mut count = 1i8;
            while i < bytes.len() && bytes[i] == (if sign > 0 { b'+' } else { b'-' }) {
                count += 1;
                i += 1;
            }
            charge = sign * count;
        }
    }

    Ok(MolAtom {
        id,
        element: elem,
        atomic_num,
        aromatic,
        formal_charge: charge,
        explicit_h,
        implicit_h: explicit_h.unwrap_or(0),
        x: 0.0,
        y: 0.0,
    })
}

fn count_components(n: usize, adj: &[Vec<(usize, u8)>]) -> usize {
    let mut visited = vec![false; n];
    let mut comps = 0usize;
    for start in 0..n {
        if visited[start] {
            continue;
        }
        comps += 1;
        let mut queue = VecDeque::new();
        queue.push_back(start);
        visited[start] = true;
        while let Some(u) = queue.pop_front() {
            for &(v, _) in &adj[u] {
                if !visited[v] {
                    visited[v] = true;
                    queue.push_back(v);
                }
            }
        }
    }
    comps
}

fn mark_ring_bonds(bonds: &mut [MolBond], n: usize) {
    // A bond (u, v) is in a ring iff u can still reach v when that bond is removed.
    for b_idx in 0..bonds.len() {
        let u = bonds[b_idx].from;
        let v = bonds[b_idx].to;
        let mut visited = vec![false; n];
        let mut queue = VecDeque::new();
        visited[u] = true;
        queue.push_back(u);
        let mut found = false;
        while let Some(curr) = queue.pop_front() {
            if curr == v {
                found = true;
                break;
            }
            for other in bonds.iter().enumerate() {
                if other.0 == b_idx {
                    continue;
                }
                let next = if other.1.from == curr {
                    other.1.to
                } else if other.1.to == curr {
                    other.1.from
                } else {
                    continue;
                };
                if !visited[next] {
                    visited[next] = true;
                    queue.push_back(next);
                }
            }
        }
        bonds[b_idx].in_ring = found;
    }
}

fn format_hill_formula(counts: &HashMap<String, usize>) -> String {
    let mut out = String::new();
    if let Some(&c) = counts.get("C") {
        out.push('C');
        if c > 1 {
            out.push_str(&c.to_string());
        }
        if let Some(&h) = counts.get("H") {
            out.push('H');
            if h > 1 {
                out.push_str(&h.to_string());
            }
        }
    }
    let mut rest: Vec<(&String, &usize)> = counts
        .iter()
        .filter(|(k, _)| {
            if counts.contains_key("C") {
                k.as_str() != "C" && k.as_str() != "H"
            } else {
                true
            }
        })
        .collect();
    rest.sort_by(|a, b| a.0.cmp(b.0));
    for (elem, &cnt) in rest {
        out.push_str(elem);
        if cnt > 1 {
            out.push_str(&cnt.to_string());
        }
    }
    out
}

fn is_amide_bond(u: usize, v: usize, atoms: &[MolAtom], adj: &[Vec<(usize, u8)>]) -> bool {
    let check = |c_idx: usize, n_idx: usize| -> bool {
        atoms[c_idx].element == "C"
            && atoms[n_idx].element == "N"
            && adj[c_idx]
                .iter()
                .any(|&(nbr, ord)| ord == 2 && atoms[nbr].element == "O")
    };
    check(u, v) || check(v, u)
}

fn count_rotatable_bonds(
    atoms: &[MolAtom],
    bonds: &[MolBond],
    adj: &[Vec<(usize, u8)>],
) -> usize {
    bonds
        .iter()
        .filter(|b| {
            b.order == 1
                && !b.in_ring
                && adj[b.from].len() > 1
                && adj[b.to].len() > 1
                && !is_amide_bond(b.from, b.to, atoms, adj)
        })
        .count()
}

/// Ertl et al. (2000) Topological Polar Surface Area (N and O fragments).
fn compute_ertl_tpsa(atoms: &[MolAtom], adj: &[Vec<(usize, u8)>]) -> f64 {
    let mut total = 0.0_f64;
    for (idx, atom) in atoms.iter().enumerate() {
        let h = atom.implicit_h;
        let deg = adj[idx].len();
        let has_double = adj[idx].iter().any(|&(_, ord)| ord == 2);
        let has_triple = adj[idx].iter().any(|&(_, ord)| ord == 3);
        if atom.element == "N" {
            if atom.aromatic {
                total += if h == 0 { 12.89 } else { 15.79 };
            } else if has_triple {
                total += 23.79;
            } else if has_double {
                total += if h == 0 { 12.36 } else { 23.85 };
            } else if deg == 3 && h == 0 {
                total += 3.24;
            } else if deg == 2 && h == 1 {
                total += 12.03;
            } else if deg == 1 && h == 2 {
                total += 26.02;
            } else {
                total += 12.03;
            }
        } else if atom.element == "O" {
            if atom.aromatic {
                total += 13.14;
            } else if has_double {
                total += 17.07;
            } else if h >= 1 {
                total += 20.23;
            } else {
                total += 9.23;
            }
        }
    }
    total
}

/// Wildman-Crippen (1999) atomic cLogP estimate.
fn compute_wildman_crippen_logp(atoms: &[MolAtom], adj: &[Vec<(usize, u8)>]) -> f64 {
    let mut sum = 0.0_f64;
    for (idx, atom) in atoms.iter().enumerate() {
        let h = atom.implicit_h as f64;
        let has_hetero_nbr = adj[idx]
            .iter()
            .any(|&(nbr, _)| atoms[nbr].element != "C");
        let has_double_o = adj[idx]
            .iter()
            .any(|&(nbr, ord)| ord == 2 && atoms[nbr].element == "O");
        let has_double = adj[idx].iter().any(|&(_, ord)| ord == 2);

        let atom_contrib = match atom.element.as_str() {
            "C" => {
                if atom.aromatic {
                    if has_hetero_nbr {
                        0.0813
                    } else if adj[idx].len() == 2 {
                        0.1581
                    } else {
                        0.2960
                    }
                } else if has_double_o {
                    -0.2783
                } else if has_double {
                    0.1551
                } else if has_hetero_nbr {
                    -0.2035
                } else {
                    0.1441
                }
            }
            "N" => {
                if atom.aromatic {
                    if h > 0.0 {
                        -0.5072
                    } else {
                        -0.3239
                    }
                } else if adj[idx]
                    .iter()
                    .any(|&(nbr, _)| adj[nbr].iter().any(|&(n2, o2)| o2 == 2 && atoms[n2].element == "O"))
                {
                    -0.7096 // amide / sulfonamide N
                } else if h >= 2.0 {
                    -1.0190
                } else if h >= 1.0 {
                    -0.7096
                } else {
                    -0.3187
                }
            }
            "O" => {
                if atom.aromatic {
                    -0.0813
                } else if has_double {
                    -0.2467
                } else if h > 0.0 {
                    -0.2893
                } else {
                    -0.0684
                }
            }
            "S" => {
                if atom.aromatic {
                    0.6237
                } else if adj[idx].iter().any(|&(nbr, ord)| ord == 2 && atoms[nbr].element == "O") {
                    -0.0024 // sulfone / sulfonamide S
                } else {
                    0.6482
                }
            }
            "F" => 0.4118,
            "Cl" => 0.6895,
            "Br" => 0.8456,
            "I" => 0.8885,
            "P" => 0.8612,
            _ => 0.0,
        };
        let h_contrib = if atom.element == "C" {
            h * 0.1230
        } else {
            h * -0.2677
        };
        sum += atom_contrib + h_contrib;
    }
    sum
}

/// Find fundamental rings for layout using shortest cycles per ring bond.
fn find_layout_rings(n: usize, bonds: &[MolBond], adj: &[Vec<(usize, u8)>]) -> Vec<Vec<usize>> {
    let mut rings: Vec<Vec<usize>> = Vec::new();
    let mut seen_sets: Vec<HashSet<usize>> = Vec::new();

    for b in bonds {
        if !b.in_ring {
            continue;
        }
        // Shortest path between b.from and b.to without using edge (b.from, b.to)
        let mut parent: Vec<Option<usize>> = vec![None; n];
        let mut visited = vec![false; n];
        let mut queue = VecDeque::new();
        visited[b.from] = true;
        queue.push_back(b.from);

        while let Some(u) = queue.pop_front() {
            if u == b.to {
                break;
            }
            for &(v, _) in &adj[u] {
                if (u == b.from && v == b.to) || (u == b.to && v == b.from) {
                    continue;
                }
                if !visited[v] {
                    visited[v] = true;
                    parent[v] = Some(u);
                    queue.push_back(v);
                }
            }
        }

        if visited[b.to] {
            let mut cycle = vec![b.to];
            let mut cur = b.to;
            while let Some(p) = parent[cur] {
                cycle.push(p);
                cur = p;
                if cur == b.from {
                    break;
                }
            }
            if cycle.len() >= 3 && cycle.len() <= 10 {
                let set: HashSet<usize> = cycle.iter().copied().collect();
                if !seen_sets.iter().any(|s| s == &set) {
                    seen_sets.push(set);
                    rings.push(cycle);
                }
            }
        }
    }

    // Sort smaller/aromatic rings first for clean fused placement
    rings.sort_by_key(|r| r.len());
    rings
}

fn generate_layout_2d(atoms: &mut [MolAtom], bonds: &[MolBond], adj: &[Vec<(usize, u8)>]) {
    let n = atoms.len();
    if n == 0 {
        return;
    }
    if n == 1 {
        atoms[0].x = 0.0;
        atoms[0].y = 0.0;
        return;
    }

    const BOND_LEN: f64 = 1.5;
    let mut placed = vec![false; n];
    let rings = find_layout_rings(n, bonds, adj);

    // 1. Place ring systems first (supports single and fused rings cleanly)
    if !rings.is_empty() {
        let r0 = &rings[0];
        let k = r0.len() as f64;
        let radius = BOND_LEN / (2.0 * (std::f64::consts::PI / k).sin());
        for (idx, &atom_id) in r0.iter().enumerate() {
            let angle = (idx as f64) * 2.0 * std::f64::consts::PI / k - std::f64::consts::FRAC_PI_2;
            atoms[atom_id].x = radius * angle.cos();
            atoms[atom_id].y = radius * angle.sin();
            placed[atom_id] = true;
        }

        // Place remaining rings fused or spiro-attached to already placed rings
        let mut progress = true;
        let mut placed_rings = vec![false; rings.len()];
        placed_rings[0] = true;
        while progress {
            progress = false;
            for (r_idx, ring) in rings.iter().enumerate() {
                if placed_rings[r_idx] {
                    continue;
                }
                let placed_in_ring: Vec<usize> =
                    ring.iter().enumerate().filter(|(_, &a)| placed[a]).map(|(i, _)| i).collect();
                if placed_in_ring.len() >= 2 {
                    // Find two consecutive placed vertices along this ring
                    let m = ring.len();
                    let mut edge_pos: Option<(usize, usize)> = None;
                    for p in 0..m {
                        let a = ring[p];
                        let b = ring[(p + 1) % m];
                        if placed[a] && placed[b] {
                            edge_pos = Some((p, (p + 1) % m));
                            break;
                        }
                    }
                    if let Some((i0, i1)) = edge_pos {
                        let a = ring[i0];
                        let b = ring[i1];
                        let ax = atoms[a].x;
                        let ay = atoms[a].y;
                        let bx = atoms[b].x;
                        let by = atoms[b].y;
                        let mx = 0.5 * (ax + bx);
                        let my = 0.5 * (ay + by);
                        let dx = bx - ax;
                        let dy = by - ay;
                        let elen = (dx * dx + dy * dy).sqrt().max(1e-6);
                        let nx = -dy / elen;
                        let ny = dx / elen;

                        // Pick outward normal away from centroid of already-placed atoms
                        let mut cx = 0.0_f64;
                        let mut cy = 0.0_f64;
                        let mut cnt = 0.0_f64;
                        for (aid, &is_p) in placed.iter().enumerate() {
                            if is_p {
                                cx += atoms[aid].x;
                                cy += atoms[aid].y;
                                cnt += 1.0;
                            }
                        }
                        cx /= cnt.max(1.0);
                        cy /= cnt.max(1.0);
                        let dot = nx * (mx - cx) + ny * (my - cy);
                        let sign = if dot >= 0.0 { 1.0 } else { -1.0 };
                        let out_nx = nx * sign;
                        let out_ny = ny * sign;

                        let k = m as f64;
                        let apothem = BOND_LEN / (2.0 * (std::f64::consts::PI / k).tan());
                        let center_x = mx + out_nx * apothem;
                        let center_y = my + out_ny * apothem;
                        let start_angle = (ay - center_y).atan2(ax - center_x);
                        let second_angle = (by - center_y).atan2(bx - center_x);
                        let mut step = second_angle - start_angle;
                        while step <= -std::f64::consts::PI {
                            step += 2.0 * std::f64::consts::PI;
                        }
                        while step > std::f64::consts::PI {
                            step -= 2.0 * std::f64::consts::PI;
                        }
                        let radius = BOND_LEN / (2.0 * (std::f64::consts::PI / k).sin());
                        for offset in 0..m {
                            let idx_in_ring = (i0 + offset) % m;
                            let aid = ring[idx_in_ring];
                            if !placed[aid] {
                                let ang = start_angle + (offset as f64) * step;
                                atoms[aid].x = center_x + radius * ang.cos();
                                atoms[aid].y = center_y + radius * ang.sin();
                                placed[aid] = true;
                            }
                        }
                        placed_rings[r_idx] = true;
                        progress = true;
                    }
                }
            }
        }
    }

    // 2. Seed unplaced connected components and expand via BFS
    for root in 0..n {
        if !placed[root] {
            // Offset new disconnected fragment if others already placed
            let max_x = atoms
                .iter()
                .enumerate()
                .filter(|(id, _)| placed[*id])
                .map(|(_, a)| a.x)
                .fold(f64::NEG_INFINITY, f64::max);
            atoms[root].x = if max_x.is_finite() { max_x + 3.0 } else { 0.0 };
            atoms[root].y = 0.0;
            placed[root] = true;
        }

        let mut queue = VecDeque::new();
        for (id, &is_p) in placed.iter().enumerate() {
            if is_p {
                queue.push_back(id);
            }
        }

        while let Some(u) = queue.pop_front() {
            let unplaced_nbrs: Vec<usize> = adj[u]
                .iter()
                .map(|&(v, _)| v)
                .filter(|&v| !placed[v])
                .collect();
            if unplaced_nbrs.is_empty() {
                continue;
            }

            let placed_nbrs: Vec<usize> = adj[u]
                .iter()
                .map(|&(v, _)| v)
                .filter(|&v| placed[v])
                .collect();

            let base_angles: Vec<f64> = if placed_nbrs.is_empty() {
                (0..unplaced_nbrs.len())
                    .map(|k| (k as f64) * 2.0 * std::f64::consts::PI / (unplaced_nbrs.len() as f64))
                    .collect()
            } else if placed_nbrs.len() == 1 {
                let p = placed_nbrs[0];
                let in_ang = (atoms[u].y - atoms[p].y).atan2(atoms[u].x - atoms[p].x);
                match unplaced_nbrs.len() {
                    1 => {
                        // Zig-zag 120 deg alternation
                        let alt = if u % 2 == 0 {
                            std::f64::consts::FRAC_PI_3
                        } else {
                            -std::f64::consts::FRAC_PI_3
                        };
                        vec![in_ang + alt]
                    }
                    2 => vec![
                        in_ang + std::f64::consts::FRAC_PI_3,
                        in_ang - std::f64::consts::FRAC_PI_3,
                    ],
                    3 => vec![
                        in_ang + std::f64::consts::FRAC_PI_2,
                        in_ang,
                        in_ang - std::f64::consts::FRAC_PI_2,
                    ],
                    k => (0..k)
                        .map(|j| {
                            in_ang
                                + ((j as f64 + 0.5) / (k as f64) - 0.5)
                                    * std::f64::consts::PI
                        })
                        .collect(),
                }
            } else {
                // Outward bisector away from average placed neighbor vector
                let mut vx = 0.0;
                let mut vy = 0.0;
                for p in placed_nbrs {
                    let dx = atoms[p].x - atoms[u].x;
                    let dy = atoms[p].y - atoms[u].y;
                    let d = (dx * dx + dy * dy).sqrt().max(1e-6);
                    vx += dx / d;
                    vy += dy / d;
                }
                let out_ang = (-vy).atan2(-vx);
                let k = unplaced_nbrs.len();
                if k == 1 {
                    vec![out_ang]
                } else {
                    (0..k)
                        .map(|j| {
                            out_ang + ((j as f64) - 0.5 * ((k - 1) as f64)) * (std::f64::consts::PI / 3.0)
                        })
                        .collect()
                }
            };

            for (v, ang) in unplaced_nbrs.into_iter().zip(base_angles.into_iter()) {
                atoms[v].x = atoms[u].x + BOND_LEN * ang.cos();
                atoms[v].y = atoms[u].y + BOND_LEN * ang.sin();
                placed[v] = true;
                queue.push_back(v);
            }
        }
    }

    // 3. Light deterministic overlap-relief + bond-length preservation pass
    for _ in 0..40 {
        let mut disp = vec![[0.0_f64; 2]; n];
        for b in bonds {
            let dx = atoms[b.to].x - atoms[b.from].x;
            let dy = atoms[b.to].y - atoms[b.from].y;
            let d = (dx * dx + dy * dy).sqrt().max(1e-6);
            let f = 0.15 * (d - BOND_LEN) / d;
            disp[b.from][0] += f * dx;
            disp[b.from][1] += f * dy;
            disp[b.to][0] -= f * dx;
            disp[b.to][1] -= f * dy;
        }
        for i in 0..n {
            for j in (i + 1)..n {
                let dx = atoms[j].x - atoms[i].x;
                let dy = atoms[j].y - atoms[i].y;
                let d2 = dx * dx + dy * dy;
                if d2 < 1.1 * 1.1 && d2 > 1e-8 {
                    let d = d2.sqrt();
                    let push = 0.08 * (1.1 - d) / d;
                    disp[i][0] -= push * dx;
                    disp[i][1] -= push * dy;
                    disp[j][0] += push * dx;
                    disp[j][1] += push * dy;
                }
            }
        }
        for i in 0..n {
            atoms[i].x += disp[i][0];
            atoms[i].y += disp[i][1];
        }
    }

    // Center layout around (0, 0)
    let mut cx = 0.0;
    let mut cy = 0.0;
    for a in atoms.iter() {
        cx += a.x;
        cy += a.y;
    }
    cx /= n as f64;
    cy /= n as f64;
    for a in atoms.iter_mut() {
        a.x -= cx;
        a.y -= cy;
    }
}
