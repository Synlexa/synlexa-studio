//! Explicit chain selection, affine-gap sequence-aware residue mapping,
//! exact f64 Kabsch rigid superposition (Horn 4x4 Jacobi eigensolver),
//! coverage accounting, and 4.5 A ligand/metal pocket contact analysis.

use std::collections::HashSet;

use crate::json::{opt_f64, opt_str, JsonValue};
use crate::sha256::sha256_hex;
use crate::structure::{
    validate_pae_json, Chain, PaeValidation, ParsedStructure, Residue,
};
use crate::{CoreError, ENGINE_NAME, ENGINE_VERSION, RUO_NOTICE};

#[derive(Debug, Clone, Default)]
pub struct StructureMeta {
    pub source_url: Option<String>,
    pub data_revision: Option<String>,
    pub retrieved_at_utc: Option<String>,
    pub license: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Coverage {
    pub numerator: usize,
    pub denominator: usize,
    pub denominator_kind: &'static str,
    pub ratio: f64,
}

impl Coverage {
    pub fn to_json(&self) -> JsonValue {
        JsonValue::object(vec![
            ("numerator", JsonValue::Number(self.numerator as f64)),
            ("denominator", JsonValue::Number(self.denominator as f64)),
            (
                "denominatorKind",
                JsonValue::String(self.denominator_kind.to_string()),
            ),
            ("ratio", JsonValue::Number(self.ratio)),
        ])
    }
}

#[derive(Debug, Clone)]
pub struct MatchedResidue {
    pub ref_seq_id: i32,
    pub ref_ins_code: String,
    pub mob_seq_id: i32,
    pub mob_ins_code: String,
    pub res_name3: String,
    pub res_code1: char,
    pub distance_angstrom: f64,
    pub ref_b_factor: Option<f64>,
    pub mob_plddt: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct LigandContact {
    pub ligand_res_name: String,
    pub ligand_chain_id: String,
    pub ligand_seq_id: i32,
    pub ligand_atom: String,
    pub protein_seq_id: i32,
    pub protein_res_name3: String,
    pub protein_atom: String,
    pub distance_angstrom: f64,
}

#[derive(Debug, Clone)]
pub struct PocketAtom {
    pub seq_id: i32,
    pub res_name3: String,
    pub atom_name: String,
    pub element: String,
    pub xyz: [f64; 3],
}

#[derive(Debug, Clone)]
pub struct TransformedResidue {
    pub seq_id: i32,
    pub ins_code: String,
    pub res_name3: String,
    pub res_code1: char,
    pub xyz: [f64; 3],
    pub plddt: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct ComparisonResult {
    pub result_id: String,
    pub engine_target: String,
    pub created_at_utc: String,
    pub ref_label: String,
    pub ref_structure: ParsedStructure,
    pub ref_chain_idx: usize,
    pub ref_meta: StructureMeta,
    pub mob_label: String,
    pub mob_structure: ParsedStructure,
    pub mob_chain_idx: usize,
    pub mob_meta: StructureMeta,
    pub matched_ca_count: usize,
    pub rmsd_angstrom: f64,
    pub ref_coverage: Coverage,
    pub mob_coverage: Coverage,
    pub pae: PaeValidation,
    pub matrix_row_major_4x4: [f64; 16],
    pub matched_residues: Vec<MatchedResidue>,
    pub mob_transformed_ca: Vec<[f64; 3]>,
    pub mob_transformed_residues: Vec<TransformedResidue>,
    pub ref_contacts: Vec<LigandContact>,
    pub ref_pocket_atoms: Vec<PocketAtom>,
}

impl ComparisonResult {
    pub fn to_json(&self) -> JsonValue {
        let ref_chain = &self.ref_structure.chains[self.ref_chain_idx];
        let mob_chain = &self.mob_structure.chains[self.mob_chain_idx];

        let ref_record = structure_input_record_json(
            &self.ref_label,
            ref_chain,
            &self.ref_structure,
            &self.ref_meta,
        );
        let mob_record = structure_input_record_json(
            &self.mob_label,
            mob_chain,
            &self.mob_structure,
            &self.mob_meta,
        );

        let matched_json: Vec<JsonValue> = self
            .matched_residues
            .iter()
            .map(|m| {
                JsonValue::object(vec![
                    ("refSeqId", JsonValue::Number(m.ref_seq_id as f64)),
                    ("refInsCode", JsonValue::String(m.ref_ins_code.clone())),
                    ("mobSeqId", JsonValue::Number(m.mob_seq_id as f64)),
                    ("mobInsCode", JsonValue::String(m.mob_ins_code.clone())),
                    ("resName3", JsonValue::String(m.res_name3.clone())),
                    ("resCode1", JsonValue::String(m.res_code1.to_string())),
                    ("distanceAngstrom", JsonValue::Number(m.distance_angstrom)),
                    ("refBFactor", opt_f64(m.ref_b_factor)),
                    ("mobPlddt", opt_f64(m.mob_plddt)),
                ])
            })
            .collect();

        let ref_ca_json: Vec<JsonValue> = ref_chain
            .residues
            .iter()
            .filter_map(|r| {
                r.ca.map(|[x, y, z]| {
                    JsonValue::Array(vec![
                        JsonValue::Number(x),
                        JsonValue::Number(y),
                        JsonValue::Number(z),
                    ])
                })
            })
            .collect();

        let ref_res_json: Vec<JsonValue> = ref_chain
            .residues
            .iter()
            .filter_map(|r| {
                r.ca.map(|[x, y, z]| {
                    JsonValue::object(vec![
                        ("seqId", JsonValue::Number(r.seq_id as f64)),
                        ("insCode", JsonValue::String(r.ins_code.clone())),
                        ("resName3", JsonValue::String(r.res_name3.clone())),
                        ("resCode1", JsonValue::String(r.res_code1.to_string())),
                        (
                            "ca",
                            JsonValue::Array(vec![
                                JsonValue::Number(x),
                                JsonValue::Number(y),
                                JsonValue::Number(z),
                            ]),
                        ),
                        ("bFactor", opt_f64(r.b_or_plddt)),
                    ])
                })
            })
            .collect();

        let ligands_json: Vec<JsonValue> = self
            .ref_structure
            .ligands
            .iter()
            .map(|lig| {
                let atoms: Vec<JsonValue> = lig
                    .atoms
                    .iter()
                    .map(|a| {
                        JsonValue::object(vec![
                            ("name", JsonValue::String(a.name.clone())),
                            ("element", JsonValue::String(a.element.clone())),
                            (
                                "xyz",
                                JsonValue::Array(vec![
                                    JsonValue::Number(a.xyz[0]),
                                    JsonValue::Number(a.xyz[1]),
                                    JsonValue::Number(a.xyz[2]),
                                ]),
                            ),
                        ])
                    })
                    .collect();
                JsonValue::object(vec![
                    ("resName", JsonValue::String(lig.res_name.clone())),
                    ("chainId", JsonValue::String(lig.chain_id.clone())),
                    ("seqId", JsonValue::Number(lig.seq_id as f64)),
                    ("atoms", JsonValue::Array(atoms)),
                ])
            })
            .collect();

        let pocket_atoms_json: Vec<JsonValue> = self
            .ref_pocket_atoms
            .iter()
            .map(|p| {
                JsonValue::object(vec![
                    ("seqId", JsonValue::Number(p.seq_id as f64)),
                    ("resName3", JsonValue::String(p.res_name3.clone())),
                    ("atomName", JsonValue::String(p.atom_name.clone())),
                    ("element", JsonValue::String(p.element.clone())),
                    (
                        "xyz",
                        JsonValue::Array(vec![
                            JsonValue::Number(p.xyz[0]),
                            JsonValue::Number(p.xyz[1]),
                            JsonValue::Number(p.xyz[2]),
                        ]),
                    ),
                ])
            })
            .collect();

        let mob_ca_json: Vec<JsonValue> = self
            .mob_transformed_ca
            .iter()
            .map(|[x, y, z]| {
                JsonValue::Array(vec![
                    JsonValue::Number(*x),
                    JsonValue::Number(*y),
                    JsonValue::Number(*z),
                ])
            })
            .collect();

        let mob_res_json: Vec<JsonValue> = self
            .mob_transformed_residues
            .iter()
            .map(|r| {
                JsonValue::object(vec![
                    ("seqId", JsonValue::Number(r.seq_id as f64)),
                    ("insCode", JsonValue::String(r.ins_code.clone())),
                    ("resName3", JsonValue::String(r.res_name3.clone())),
                    ("resCode1", JsonValue::String(r.res_code1.to_string())),
                    (
                        "xyz",
                        JsonValue::Array(vec![
                            JsonValue::Number(r.xyz[0]),
                            JsonValue::Number(r.xyz[1]),
                            JsonValue::Number(r.xyz[2]),
                        ]),
                    ),
                    ("plddt", opt_f64(r.plddt)),
                ])
            })
            .collect();

        let contacts_json: Vec<JsonValue> = self
            .ref_contacts
            .iter()
            .map(|c| {
                JsonValue::object(vec![
                    (
                        "ligandResName",
                        JsonValue::String(c.ligand_res_name.clone()),
                    ),
                    (
                        "ligandChainId",
                        JsonValue::String(c.ligand_chain_id.clone()),
                    ),
                    ("ligandSeqId", JsonValue::Number(c.ligand_seq_id as f64)),
                    ("ligandAtom", JsonValue::String(c.ligand_atom.clone())),
                    ("proteinSeqId", JsonValue::Number(c.protein_seq_id as f64)),
                    (
                        "proteinResName3",
                        JsonValue::String(c.protein_res_name3.clone()),
                    ),
                    ("proteinAtom", JsonValue::String(c.protein_atom.clone())),
                    ("distanceAngstrom", JsonValue::Number(c.distance_angstrom)),
                ])
            })
            .collect();

        JsonValue::object(vec![
            ("schemaVersion", JsonValue::String("1.0.0".to_string())),
            ("ruoNotice", JsonValue::String(RUO_NOTICE.to_string())),
            ("resultId", JsonValue::String(self.result_id.clone())),
            (
                "engine",
                JsonValue::object(vec![
                    ("name", JsonValue::String(ENGINE_NAME.to_string())),
                    ("version", JsonValue::String(ENGINE_VERSION.to_string())),
                    ("target", JsonValue::String(self.engine_target.clone())),
                    ("floatPrecision", JsonValue::String("float64".to_string())),
                ]),
            ),
            ("createdAtUtc", JsonValue::String(self.created_at_utc.clone())),
            ("reference", ref_record),
            ("mobile", mob_record),
            (
                "metrics",
                JsonValue::object(vec![
                    (
                        "matchedCaCount",
                        JsonValue::Number(self.matched_ca_count as f64),
                    ),
                    ("rmsdAngstrom", JsonValue::Number(self.rmsd_angstrom)),
                    ("units", JsonValue::String("angstrom".to_string())),
                    ("refCoverage", self.ref_coverage.to_json()),
                    ("mobCoverage", self.mob_coverage.to_json()),
                    (
                        "paeStatus",
                        JsonValue::String(self.pae.status.to_string()),
                    ),
                ]),
            ),
            (
                "transform",
                JsonValue::object(vec![
                    (
                        "direction",
                        JsonValue::String("mobile_to_reference".to_string()),
                    ),
                    (
                        "matrixRowMajor4x4",
                        JsonValue::Array(
                            self.matrix_row_major_4x4
                                .iter()
                                .map(|v| JsonValue::Number(*v))
                                .collect(),
                        ),
                    ),
                ]),
            ),
            ("matchedResidues", JsonValue::Array(matched_json)),
            (
                "refDisplayAtoms",
                JsonValue::object(vec![
                    ("ca", JsonValue::Array(ref_ca_json)),
                    ("residues", JsonValue::Array(ref_res_json)),
                    ("ligands", JsonValue::Array(ligands_json)),
                    ("pocketAtoms", JsonValue::Array(pocket_atoms_json)),
                ]),
            ),
            ("mobTransformedCa", JsonValue::Array(mob_ca_json)),
            ("mobTransformedResidues", JsonValue::Array(mob_res_json)),
            ("refContacts", JsonValue::Array(contacts_json)),
            ("paeMatrixSummary", self.pae.to_summary_json()),
        ])
    }
}

fn structure_input_record_json(
    label: &str,
    chain: &Chain,
    structure: &ParsedStructure,
    meta: &StructureMeta,
) -> JsonValue {
    JsonValue::object(vec![
        ("label", JsonValue::String(label.to_string())),
        ("chainId", JsonValue::String(chain.chain_id.clone())),
        ("authChainId", opt_str(Some(chain.auth_chain_id.as_str()))),
        ("modelIndex", JsonValue::Number(structure.model_index as f64)),
        ("sha256", JsonValue::String(structure.sha256.clone())),
        (
            "confidenceKind",
            JsonValue::String(structure.confidence_kind.as_str().to_string()),
        ),
        ("sourceUrl", opt_str(meta.source_url.as_deref())),
        ("dataRevision", opt_str(meta.data_revision.as_deref())),
        ("retrievedAtUtc", opt_str(meta.retrieved_at_utc.as_deref())),
        ("license", opt_str(meta.license.as_deref())),
    ])
}

/// Select an explicit chain or require unambiguous single polymer chain.
pub fn select_chain_index(
    structure: &ParsedStructure,
    requested: Option<&str>,
    role: &str,
) -> Result<usize, CoreError> {
    let req = requested.map(str::trim).filter(|s| !s.is_empty());
    match req {
        None => {
            if structure.chains.len() == 1 {
                Ok(0)
            } else {
                let chains_json: Vec<JsonValue> = structure
                    .chains
                    .iter()
                    .map(|c| JsonValue::String(c.chain_id.clone()))
                    .collect();
                Err(CoreError::with_details(
                    "ERR_AMBIGUOUS_CHAIN",
                    format!(
                        "{} structure has {} polymer chains; explicit chain selection is required",
                        role,
                        structure.chains.len()
                    ),
                    JsonValue::object(vec![
                        ("role", JsonValue::String(role.to_string())),
                        ("chains", JsonValue::Array(chains_json)),
                    ]),
                ))
            }
        }
        Some(target) => {
            if let Some(idx) = structure
                .chains
                .iter()
                .position(|c| c.chain_id == target || c.auth_chain_id == target)
            {
                return Ok(idx);
            }
            let available: Vec<JsonValue> = structure
                .chains
                .iter()
                .map(|c| JsonValue::String(c.chain_id.clone()))
                .collect();
            Err(CoreError::with_details(
                "ERR_INVALID_INPUT",
                format!(
                    "Requested {} chain '{}' not found in structure",
                    role, target
                ),
                JsonValue::object(vec![
                    ("role", JsonValue::String(role.to_string())),
                    ("chains", JsonValue::Array(available)),
                ]),
            ))
        }
    }
}

/// Align observed C-alpha residues using Gotoh affine-gap Needleman-Wunsch
/// with residue-ID tie-breaking. Returns pairs of indices into `ref_obs` and `mob_obs`.
pub fn align_residues(ref_obs: &[&Residue], mob_obs: &[&Residue]) -> Vec<(usize, usize)> {
    let n = ref_obs.len();
    let m = mob_obs.len();
    if n == 0 || m == 0 {
        return Vec::new();
    }

    // Fast path when sequences and residue IDs are already identical 1:1
    if n == m
        && ref_obs
            .iter()
            .zip(mob_obs.iter())
            .all(|(r, mb)| r.res_code1 == mb.res_code1 && r.seq_id == mb.seq_id)
    {
        return (0..n).map(|i| (i, i)).collect();
    }

    const NEG_INF: f64 = -1e18;
    const GAP_OPEN: f64 = -6.0;
    const GAP_EXTEND: f64 = -1.0;

    let stride = m + 1;
    let size = (n + 1) * stride;
    let mut m_dp = vec![NEG_INF; size]; // match/mismatch
    let mut ix_dp = vec![NEG_INF; size]; // gap in mob (ref advances)
    let mut iy_dp = vec![NEG_INF; size]; // gap in ref (mob advances)
    let mut tb_m = vec![0u8; size]; // 0: from M, 1: from Ix, 2: from Iy
    let mut tb_x = vec![0u8; size]; // 0: open from M, 1: extend from Ix
    let mut tb_y = vec![0u8; size]; // 0: open from M, 1: extend from Iy

    m_dp[0] = 0.0;
    for i in 1..=n {
        ix_dp[i * stride] = GAP_OPEN + (i as f64 - 1.0) * GAP_EXTEND;
        tb_x[i * stride] = if i == 1 { 0 } else { 1 };
    }
    for j in 1..=m {
        iy_dp[j] = GAP_OPEN + (j as f64 - 1.0) * GAP_EXTEND;
        tb_y[j] = if j == 1 { 0 } else { 1 };
    }

    for i in 1..=n {
        let r = ref_obs[i - 1];
        for j in 1..=m {
            let mb = mob_obs[j - 1];
            let idx = i * stride + j;

            let mut sub = if r.res_code1 == mb.res_code1 && r.res_code1 != 'X' {
                4.0
            } else if r.res_code1 == mb.res_code1 {
                2.0
            } else {
                -2.0
            };
            // Residue-ID tie-breaker so N-terminal His repeats / missing coords align canonically
            if r.seq_id == mb.seq_id && r.ins_code == mb.ins_code {
                sub += 0.5;
            } else if r.label_seq_id.is_some() && r.label_seq_id == mb.label_seq_id {
                sub += 0.4;
            } else if r.label_seq_id == Some(mb.seq_id) || mb.label_seq_id == Some(r.seq_id) {
                sub += 0.3;
            }

            // Transition into M[i, j]
            let prev_idx = (i - 1) * stride + (j - 1);
            let pm = m_dp[prev_idx];
            let px = ix_dp[prev_idx];
            let py = iy_dp[prev_idx];
            if pm >= px && pm >= py {
                m_dp[idx] = pm + sub;
                tb_m[idx] = 0;
            } else if px >= py {
                m_dp[idx] = px + sub;
                tb_m[idx] = 1;
            } else {
                m_dp[idx] = py + sub;
                tb_m[idx] = 2;
            }

            // Transition into Ix[i, j] (ref[i-1] aligned to gap)
            let up_idx = (i - 1) * stride + j;
            let open_x = m_dp[up_idx] + GAP_OPEN;
            let ext_x = ix_dp[up_idx] + GAP_EXTEND;
            if open_x >= ext_x {
                ix_dp[idx] = open_x;
                tb_x[idx] = 0;
            } else {
                ix_dp[idx] = ext_x;
                tb_x[idx] = 1;
            }

            // Transition into Iy[i, j] (mob[j-1] aligned to gap)
            let left_idx = i * stride + (j - 1);
            let open_y = m_dp[left_idx] + GAP_OPEN;
            let ext_y = iy_dp[left_idx] + GAP_EXTEND;
            if open_y >= ext_y {
                iy_dp[idx] = open_y;
                tb_y[idx] = 0;
            } else {
                iy_dp[idx] = ext_y;
                tb_y[idx] = 1;
            }
        }
    }

    let last = n * stride + m;
    let mut state = if m_dp[last] >= ix_dp[last] && m_dp[last] >= iy_dp[last] {
        0u8
    } else if ix_dp[last] >= iy_dp[last] {
        1u8
    } else {
        2u8
    };

    let mut pairs = Vec::new();
    let mut i = n;
    let mut j = m;
    while i > 0 || j > 0 {
        let idx = i * stride + j;
        match state {
            0 => {
                if i == 0 || j == 0 {
                    break;
                }
                pairs.push((i - 1, j - 1));
                state = tb_m[idx];
                i -= 1;
                j -= 1;
            }
            1 => {
                if i == 0 {
                    break;
                }
                state = tb_x[idx];
                i -= 1;
            }
            _ => {
                if j == 0 {
                    break;
                }
                state = tb_y[idx];
                j -= 1;
            }
        }
    }
    pairs.reverse();
    pairs
}

/// Exact f64 Kabsch rigid superposition (`mobile` -> `reference`) using Horn's
/// unit quaternion 4x4 symmetric Jacobi eigensolver. Guarantees det(R) = +1.
/// Returns `(matrix_row_major_4x4, rmsd_angstrom)`.
pub fn kabsch_superpose(
    ref_pts: &[[f64; 3]],
    mob_pts: &[[f64; 3]],
) -> Result<([f64; 16], f64), CoreError> {
    let count = ref_pts.len();
    if count != mob_pts.len() || count < 3 {
        return Err(CoreError::new(
            "ERR_NO_COORDINATES",
            format!(
                "At least 3 matched C-alpha coordinates required for rigid superposition (got {})",
                count
            ),
        ));
    }

    let inv_n = 1.0 / (count as f64);
    let mut c_ref = [0.0_f64; 3];
    let mut c_mob = [0.0_f64; 3];
    for i in 0..count {
        for k in 0..3 {
            c_ref[k] += ref_pts[i][k];
            c_mob[k] += mob_pts[i][k];
        }
    }
    for k in 0..3 {
        c_ref[k] *= inv_n;
        c_mob[k] *= inv_n;
    }

    // Cross-covariance S[a][b] = sum_i dp_i[a] * dq_i[b]
    let mut s = [[0.0_f64; 3]; 3];
    for i in 0..count {
        let dp = [
            mob_pts[i][0] - c_mob[0],
            mob_pts[i][1] - c_mob[1],
            mob_pts[i][2] - c_mob[2],
        ];
        let dq = [
            ref_pts[i][0] - c_ref[0],
            ref_pts[i][1] - c_ref[1],
            ref_pts[i][2] - c_ref[2],
        ];
        for a in 0..3 {
            for b in 0..3 {
                s[a][b] += dp[a] * dq[b];
            }
        }
    }

    let sxx = s[0][0];
    let sxy = s[0][1];
    let sxz = s[0][2];
    let syx = s[1][0];
    let syy = s[1][1];
    let syz = s[1][2];
    let szx = s[2][0];
    let szy = s[2][1];
    let szz = s[2][2];

    let mut k_mat = [
        [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
        [syz - szy, sxx - syy - szz, sxy + syx, sxz + szx],
        [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
        [sxy - syx, sxz + szx, syz + szy, -sxx - syy + szz],
    ];

    let q = max_eigenvector_4x4_jacobi(&mut k_mat);
    let r = quat_to_matrix3(q);

    // Translation t = c_ref - R * c_mob
    let rc_mob = mat3_mul_vec3(&r, c_mob);
    let t = [
        c_ref[0] - rc_mob[0],
        c_ref[1] - rc_mob[1],
        c_ref[2] - rc_mob[2],
    ];

    let matrix = [
        r[0][0], r[0][1], r[0][2], t[0], r[1][0], r[1][1], r[1][2], t[1], r[2][0], r[2][1],
        r[2][2], t[2], 0.0, 0.0, 0.0, 1.0,
    ];

    let mut sq_sum = 0.0_f64;
    for i in 0..count {
        let p_t = transform_point(&matrix, mob_pts[i]);
        let dx = p_t[0] - ref_pts[i][0];
        let dy = p_t[1] - ref_pts[i][1];
        let dz = p_t[2] - ref_pts[i][2];
        sq_sum += dx * dx + dy * dy + dz * dz;
    }
    let rmsd = (sq_sum * inv_n).sqrt();

    Ok((matrix, rmsd))
}

fn max_eigenvector_4x4_jacobi(a: &mut [[f64; 4]; 4]) -> [f64; 4] {
    let mut v = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ];

    for _sweep in 0..64 {
        let mut max_off = 0.0_f64;
        for p in 0..4 {
            for q in (p + 1)..4 {
                max_off = max_off.max(a[p][q].abs());
            }
        }
        if max_off < 1e-15 {
            break;
        }
        for p in 0..4 {
            for q in (p + 1)..4 {
                let apq = a[p][q];
                if apq.abs() < 1e-16 {
                    continue;
                }
                let tau = (a[q][q] - a[p][p]) / (2.0 * apq);
                let t = if tau >= 0.0 {
                    1.0 / (tau + (1.0 + tau * tau).sqrt())
                } else {
                    -1.0 / (-tau + (1.0 + tau * tau).sqrt())
                };
                let c = 1.0 / (1.0 + t * t).sqrt();
                let s = t * c;
                let app = a[p][p];
                let aqq = a[q][q];
                a[p][p] = app - t * apq;
                a[q][q] = aqq + t * apq;
                a[p][q] = 0.0;
                a[q][p] = 0.0;

                for r in 0..4 {
                    if r != p && r != q {
                        let arp = a[r][p];
                        let arq = a[r][q];
                        a[r][p] = c * arp - s * arq;
                        a[p][r] = a[r][p];
                        a[r][q] = s * arp + c * arq;
                        a[q][r] = a[r][q];
                    }
                }
                for r in 0..4 {
                    let vrp = v[r][p];
                    let vrq = v[r][q];
                    v[r][p] = c * vrp - s * vrq;
                    v[r][q] = s * vrp + c * vrq;
                }
            }
        }
    }

    let mut best_col = 0;
    let mut best_val = a[0][0];
    for c in 1..4 {
        if a[c][c] > best_val {
            best_val = a[c][c];
            best_col = c;
        }
    }

    let mut q = [v[0][best_col], v[1][best_col], v[2][best_col], v[3][best_col]];
    let norm = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if norm > 1e-15 {
        for x in &mut q {
            *x /= norm;
        }
    } else {
        q = [1.0, 0.0, 0.0, 0.0];
    }
    q
}

fn quat_to_matrix3(q: [f64; 4]) -> [[f64; 3]; 3] {
    let [w, x, y, z] = q;
    [
        [
            w * w + x * x - y * y - z * z,
            2.0 * (x * y - w * z),
            2.0 * (x * z + w * y),
        ],
        [
            2.0 * (x * y + w * z),
            w * w - x * x + y * y - z * z,
            2.0 * (y * z - w * x),
        ],
        [
            2.0 * (x * z - w * y),
            2.0 * (y * z + w * x),
            w * w - x * x - y * y + z * z,
        ],
    ]
}

fn mat3_mul_vec3(m: &[[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

pub fn transform_point(m: &[f64; 16], p: [f64; 3]) -> [f64; 3] {
    [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ]
}

fn dist3(a: [f64; 3], b: [f64; 3]) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

pub fn compute_ligand_contacts(
    structure: &ParsedStructure,
    chain_idx: usize,
    cutoff_angstrom: f64,
) -> (Vec<LigandContact>, Vec<PocketAtom>) {
    let chain = &structure.chains[chain_idx];
    let mut contacts = Vec::new();
    let mut pocket_atoms = Vec::new();
    let mut seen_pocket: HashSet<(i32, String)> = HashSet::new();

    for lig in &structure.ligands {
        for la in &lig.atoms {
            for res in &chain.residues {
                for pa in &res.atoms {
                    let d = dist3(la.xyz, pa.xyz);
                    if d <= cutoff_angstrom {
                        contacts.push(LigandContact {
                            ligand_res_name: lig.res_name.clone(),
                            ligand_chain_id: lig.chain_id.clone(),
                            ligand_seq_id: lig.seq_id,
                            ligand_atom: la.name.clone(),
                            protein_seq_id: res.seq_id,
                            protein_res_name3: res.res_name3.clone(),
                            protein_atom: pa.name.clone(),
                            distance_angstrom: d,
                        });
                        if seen_pocket.insert((res.seq_id, pa.name.clone())) {
                            pocket_atoms.push(PocketAtom {
                                seq_id: res.seq_id,
                                res_name3: res.res_name3.clone(),
                                atom_name: pa.name.clone(),
                                element: pa.element.clone(),
                                xyz: pa.xyz,
                            });
                        }
                    }
                }
            }
        }
    }

    contacts.sort_by(|a, b| {
        a.ligand_seq_id
            .cmp(&b.ligand_seq_id)
            .then_with(|| a.distance_angstrom.total_cmp(&b.distance_angstrom))
    });

    (contacts, pocket_atoms)
}

#[allow(clippy::too_many_arguments)]
pub fn compare_structures(
    ref_label: &str,
    ref_structure: ParsedStructure,
    ref_chain_req: Option<&str>,
    ref_meta: StructureMeta,
    mob_label: &str,
    mob_structure: ParsedStructure,
    mob_chain_req: Option<&str>,
    mob_meta: StructureMeta,
    pae_json: Option<&str>,
    engine_target: &str,
    created_at_utc: &str,
) -> Result<ComparisonResult, CoreError> {
    let ref_chain_idx = select_chain_index(&ref_structure, ref_chain_req, "reference")?;
    let mob_chain_idx = select_chain_index(&mob_structure, mob_chain_req, "mobile")?;

    let ref_chain = &ref_structure.chains[ref_chain_idx];
    let mob_chain = &mob_structure.chains[mob_chain_idx];

    let ref_obs: Vec<&Residue> = ref_chain.residues.iter().filter(|r| r.ca.is_some()).collect();
    let mob_obs: Vec<&Residue> = mob_chain.residues.iter().filter(|r| r.ca.is_some()).collect();

    let aligned = align_residues(&ref_obs, &mob_obs);
    if aligned.len() < 3 {
        return Err(CoreError::new(
            "ERR_NO_COORDINATES",
            format!(
                "Insufficient aligned C-alpha residues for superposition (matched {})",
                aligned.len()
            ),
        ));
    }

    let mut ref_pts = Vec::with_capacity(aligned.len());
    let mut mob_pts = Vec::with_capacity(aligned.len());
    for &(ri, mi) in &aligned {
        if let (Some(rp), Some(mp)) = (ref_obs[ri].ca, mob_obs[mi].ca) {
            ref_pts.push(rp);
            mob_pts.push(mp);
        }
    }

    let (matrix, rmsd) = kabsch_superpose(&ref_pts, &mob_pts)?;

    let mut matched_residues = Vec::with_capacity(aligned.len());
    for &(ri, mi) in &aligned {
        let r = ref_obs[ri];
        let m = mob_obs[mi];
        let rp = r.ca.unwrap();
        let mp_t = transform_point(&matrix, m.ca.unwrap());
        let d = dist3(rp, mp_t);
        matched_residues.push(MatchedResidue {
            ref_seq_id: r.seq_id,
            ref_ins_code: r.ins_code.clone(),
            mob_seq_id: m.seq_id,
            mob_ins_code: m.ins_code.clone(),
            res_name3: r.res_name3.clone(),
            res_code1: r.res_code1,
            distance_angstrom: d,
            ref_b_factor: r.b_or_plddt,
            mob_plddt: m.b_or_plddt,
        });
    }

    let mob_transformed_ca: Vec<[f64; 3]> = mob_obs
        .iter()
        .map(|m| transform_point(&matrix, m.ca.unwrap()))
        .collect();
    let mob_transformed_residues: Vec<TransformedResidue> = mob_obs
        .iter()
        .zip(mob_transformed_ca.iter())
        .map(|(m, &xyz)| TransformedResidue {
            seq_id: m.seq_id,
            ins_code: m.ins_code.clone(),
            res_name3: m.res_name3.clone(),
            res_code1: m.res_code1,
            xyz,
            plddt: m.b_or_plddt,
        })
        .collect();

    let matched_count = matched_residues.len();
    let ref_denom = ref_chain.model_residue_count().max(1);
    let mob_denom = mob_chain.model_residue_count().max(1);

    let ref_coverage = Coverage {
        numerator: matched_count,
        denominator: ref_denom,
        denominator_kind: ref_chain.denominator_kind(),
        ratio: (matched_count as f64 / ref_denom as f64).min(1.0),
    };
    let mob_coverage = Coverage {
        numerator: matched_count,
        denominator: mob_denom,
        denominator_kind: mob_chain.denominator_kind(),
        ratio: (matched_count as f64 / mob_denom as f64).min(1.0),
    };

    let pae = validate_pae_json(pae_json, mob_chain.model_residue_count());
    let (ref_contacts, ref_pocket_atoms) = compute_ligand_contacts(&ref_structure, ref_chain_idx, 4.5);

    let id_seed = format!(
        "{}:{}:{}:{}:{}",
        ref_structure.sha256,
        mob_structure.sha256,
        ref_chain.chain_id,
        mob_chain.chain_id,
        engine_target
    );
    let result_id = format!("cmp_{}", &sha256_hex(id_seed.as_bytes())[..16]);

    Ok(ComparisonResult {
        result_id,
        engine_target: engine_target.to_string(),
        created_at_utc: created_at_utc.to_string(),
        ref_label: ref_label.to_string(),
        ref_structure,
        ref_chain_idx,
        ref_meta,
        mob_label: mob_label.to_string(),
        mob_structure,
        mob_chain_idx,
        mob_meta,
        matched_ca_count: matched_count,
        rmsd_angstrom: rmsd,
        ref_coverage,
        mob_coverage,
        pae,
        matrix_row_major_4x4: matrix,
        matched_residues,
        mob_transformed_ca,
        mob_transformed_residues,
        ref_contacts,
        ref_pocket_atoms,
    })
}
