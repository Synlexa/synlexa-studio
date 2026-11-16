use std::path::PathBuf;

use synlexa_bio_core::chemistry::analyze_molecule_smiles;
use synlexa_bio_core::genomics::{analyze_gene_crispr, translate_cds, SEEDED_TRANSCRIPTS};
use synlexa_bio_core::json::parse_json;
use synlexa_bio_core::peptide::analyze_peptide;
use synlexa_bio_core::ramachandran::{
    analyze_ramachandran, dihedral_deg, RamachandranRegion,
};
use synlexa_bio_core::structure::{
    parse_structure, ConfidenceKind, SourceTypeHint, MAX_INPUT_BYTES,
};
use synlexa_bio_core::superpose::{compare_structures, kabsch_superpose, transform_point, StructureMeta};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(name)
}

#[test]
fn test_3hs4_vs_af_p00918_cif_and_pae() {
    let ref_cif = std::fs::read_to_string(fixture_path("3HS4.cif")).unwrap();
    let mob_cif = std::fs::read_to_string(fixture_path("AF-P00918-F1-model_v6.cif")).unwrap();
    let pae_json =
        std::fs::read_to_string(fixture_path("AF-P00918-F1-predicted_aligned_error_v6.json"))
            .unwrap();

    let ref_parsed = parse_structure(&ref_cif, SourceTypeHint::Auto).unwrap();
    let mob_parsed = parse_structure(&mob_cif, SourceTypeHint::Auto).unwrap();

    assert_eq!(
        ref_parsed.sha256,
        "84e006ac301979de150f351fdc235a97ba73bffec8514dfe6c96447517da91d6"
    );
    assert_eq!(
        mob_parsed.sha256,
        "173c4f1fa81ffb1a288c881040217d1473ed2d08cd792671252ee116cac10c7d"
    );
    assert_eq!(ref_parsed.confidence_kind, ConfidenceKind::ExperimentalBFactor);
    assert_eq!(mob_parsed.confidence_kind, ConfidenceKind::PredictionPlddt);
    assert!(ref_parsed.chains[0].has_alt_locs);
    assert!(ref_parsed.ligands.iter().any(|l| l.res_name == "ZN"));
    assert!(ref_parsed.ligands.iter().any(|l| l.res_name == "AZM"));
    assert!(ref_parsed.ligands.iter().any(|l| l.res_name == "GOL"));

    let cmp = compare_structures(
        "3HS4.cif",
        ref_parsed,
        Some("A"),
        StructureMeta::default(),
        "AF-P00918-F1-model_v6.cif",
        mob_parsed,
        Some("A"),
        StructureMeta::default(),
        Some(&pae_json),
        "native-rust",
        "2026-11-15T09:00:00Z",
    )
    .unwrap();

    assert_eq!(cmp.matched_ca_count, 257);
    assert_eq!(cmp.ref_coverage.numerator, 257);
    assert_eq!(cmp.ref_coverage.denominator, 260);
    assert_eq!(cmp.ref_coverage.denominator_kind, "declared_polymer_sequence");
    assert_eq!(cmp.mob_coverage.numerator, 257);
    assert_eq!(cmp.mob_coverage.denominator, 260);
    assert_eq!(cmp.pae.status, "valid");
    assert_eq!(cmp.pae.size, 260);
    assert!(cmp.rmsd_angstrom < 1.0, "Expected sub-1A CA2 RMSD, got {}", cmp.rmsd_angstrom);

    // Check ZN 301 coordination to His94, His96, His119 within 4.5 A
    let zn_his: Vec<i32> = cmp
        .ref_contacts
        .iter()
        .filter(|c| c.ligand_res_name == "ZN" && c.protein_res_name3 == "HIS")
        .map(|c| c.protein_seq_id)
        .collect();
    assert!(zn_his.contains(&94));
    assert!(zn_his.contains(&96));
    assert!(zn_his.contains(&119));
}

#[test]
fn test_3hs4_vs_af_p00918_pdb() {
    let ref_pdb = std::fs::read_to_string(fixture_path("3HS4.pdb")).unwrap();
    let mob_pdb = std::fs::read_to_string(fixture_path("AF-P00918-F1-model_v6.pdb")).unwrap();

    let ref_parsed = parse_structure(&ref_pdb, SourceTypeHint::Auto).unwrap();
    let mob_parsed = parse_structure(&mob_pdb, SourceTypeHint::Auto).unwrap();

    assert_eq!(ref_parsed.confidence_kind, ConfidenceKind::ExperimentalBFactor);
    assert_eq!(mob_parsed.confidence_kind, ConfidenceKind::PredictionPlddt);

    let cmp = compare_structures(
        "3HS4.pdb",
        ref_parsed,
        Some("A"),
        StructureMeta::default(),
        "AF-P00918-F1-model_v6.pdb",
        mob_parsed,
        Some("A"),
        StructureMeta::default(),
        None,
        "native-rust",
        "2026-11-15T09:00:00Z",
    )
    .unwrap();
    assert_eq!(cmp.matched_ca_count, 257);
    assert_eq!(cmp.pae.status, "missing");
}

#[test]
fn test_synthetic_rigid_transform_recovery() {
    let ref_pts = [
        [1.2, -0.5, 3.1],
        [4.5, 2.1, 0.8],
        [6.3, -1.9, 4.4],
        [2.0, 5.4, -2.3],
        [-3.1, 1.7, 2.9],
        [0.4, -4.2, -1.1],
    ];
    let theta = 0.73_f64;
    let c = theta.cos();
    let s = theta.sin();
    let rot = [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]];
    let t = [12.5, -8.25, 4.75];

    let mob_pts: Vec<[f64; 3]> = ref_pts
        .iter()
        .map(|p| {
            [
                rot[0][0] * p[0] + rot[0][1] * p[1] + rot[0][2] * p[2] + t[0],
                rot[1][0] * p[0] + rot[1][1] * p[1] + rot[1][2] * p[2] + t[1],
                rot[2][0] * p[0] + rot[2][1] * p[1] + rot[2][2] * p[2] + t[2],
            ]
        })
        .collect();

    let (mat, rmsd) = kabsch_superpose(&ref_pts, &mob_pts).unwrap();
    assert!(rmsd < 1e-10, "RMSD too high: {}", rmsd);
    for (r, m) in ref_pts.iter().zip(mob_pts.iter()) {
        let rec = transform_point(&mat, *m);
        let d = ((rec[0] - r[0]).powi(2) + (rec[1] - r[1]).powi(2) + (rec[2] - r[2]).powi(2))
            .sqrt();
        assert!(d < 1e-10);
    }
}

#[test]
fn test_ambiguous_chain_and_error_guards() {
    let two_chain_pdb = "\
ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 10.00           C  
ATOM      2  CA  GLY A   2       4.000   2.000   3.000  1.00 10.00           C  
ATOM      3  CA  VAL A   3       7.000   2.000   3.000  1.00 10.00           C  
ATOM      4  CA  ALA B   1       1.000   5.000   3.000  1.00 10.00           C  
ATOM      5  CA  GLY B   2       4.000   5.000   3.000  1.00 10.00           C  
ATOM      6  CA  VAL B   3       7.000   5.000   3.000  1.00 10.00           C  
";
    let p1 = parse_structure(two_chain_pdb, SourceTypeHint::Auto).unwrap();
    let p2 = parse_structure(two_chain_pdb, SourceTypeHint::Auto).unwrap();
    let err = compare_structures(
        "r",
        p1,
        None,
        StructureMeta::default(),
        "m",
        p2,
        Some("A"),
        StructureMeta::default(),
        None,
        "native-rust",
        "2026-11-15T00:00:00Z",
    )
    .unwrap_err();
    assert_eq!(err.code, "ERR_AMBIGUOUS_CHAIN");

    let empty_err = parse_structure("   \n", SourceTypeHint::Auto).unwrap_err();
    assert_eq!(empty_err.code, "ERR_MALFORMED_STRUCTURE");

    let no_coords = parse_structure("HEADER    TEST\nREMARK   1 NONE\n", SourceTypeHint::Auto)
        .unwrap_err();
    assert_eq!(no_coords.code, "ERR_NO_COORDINATES");

    let oversized = "A".repeat(MAX_INPUT_BYTES + 1);
    let over_err = parse_structure(&oversized, SourceTypeHint::Auto).unwrap_err();
    assert_eq!(over_err.code, "ERR_OVERSIZED_INPUT");
}

#[test]
fn test_altlocs_and_insertion_codes_pdb() {
    let pdb = "\
ATOM      1  CA AALA A  10A      1.000   0.000   0.000  0.30 12.00           C  
ATOM      2  CA BALA A  10A      2.000   0.000   0.000  0.70 12.00           C  
ATOM      3  CA  GLY A  10B      5.000   0.000   0.000  1.00 14.00           C  
ATOM      4  CA  VAL A  11       8.000   0.000   0.000  1.00 16.00           C  
";
    let parsed = parse_structure(pdb, SourceTypeHint::Auto).unwrap();
    let c = &parsed.chains[0];
    assert!(c.has_alt_locs);
    assert!(c.has_insertion_codes);
    assert_eq!(c.residues.len(), 3);
    // Highest occupancy 0.70 (altLoc B) selected for 10A
    assert_eq!(c.residues[0].ca.unwrap()[0], 2.0);
    assert_eq!(c.residues[0].ins_code, "A");
    assert_eq!(c.residues[1].ins_code, "B");
}

#[test]
fn test_peptide_mutations_and_3d_contacts() {
    let ref_cif = std::fs::read_to_string(fixture_path("3HS4.cif")).unwrap();
    let af_cif = std::fs::read_to_string(fixture_path("AF-P00918-F1-model_v6.cif")).unwrap();
    let af_parsed = parse_structure(&af_cif, SourceTypeHint::Auto).unwrap();
    let p00918_seq = af_parsed.chains[0].declared_sequence.clone().unwrap();
    assert_eq!(p00918_seq.len(), 260);

    let res = analyze_peptide(
        &p00918_seq,
        &["H94A".to_string(), "T199V".to_string()],
        None,
        None,
        Some(&ref_cif),
        Some("A"),
        Some(94),
    )
    .unwrap();
    assert_eq!(res.wild_type.length, 260);
    assert_eq!(res.engineered.length, 260);
    assert_eq!(res.titration_curve.len(), 29);
    assert_eq!(res.applied_mutations.len(), 2);
    assert!(!res.local_3d_contacts.is_empty());
    assert!(res.local_3d_contacts.iter().all(|c| c.distance_angstrom < 5.0));
}

#[test]
fn test_genomics_ca2_tp53_hbb_and_pams() {
    // Verify CA2 NM_000067.3 translates to exact UniProt P00918 260aa from AF fixture
    let af_cif = std::fs::read_to_string(fixture_path("AF-P00918-F1-model_v6.cif")).unwrap();
    let af_parsed = parse_structure(&af_cif, SourceTypeHint::Auto).unwrap();
    let p00918_seq = af_parsed.chains[0].declared_sequence.clone().unwrap();

    let ca2 = SEEDED_TRANSCRIPTS
        .iter()
        .find(|t| t.transcript_id == "NM_000067.3")
        .unwrap();
    let ca2_prot = translate_cds(ca2.cds);
    assert_eq!(ca2_prot, p00918_seq);

    let tp53 = SEEDED_TRANSCRIPTS
        .iter()
        .find(|t| t.transcript_id == "NM_000546.6")
        .unwrap();
    assert_eq!(translate_cds(tp53.cds).len(), 393);

    let hbb = SEEDED_TRANSCRIPTS
        .iter()
        .find(|t| t.transcript_id == "NM_000518.5")
        .unwrap();
    assert_eq!(translate_cds(hbb.cds).len(), 147);

    // Missense edit at CA2 codon 94 (CAT -> CGT = H94R)
    let g_res = analyze_gene_crispr(
        Some("NM_000067.3"),
        None,
        94,
        Some(2),
        Some("G"),
        Some("all"),
    )
    .unwrap();
    assert_eq!(g_res.wt_aa, 'H');
    assert_eq!(g_res.edited_aa, 'R');
    assert_eq!(g_res.consequence, "missense");
    assert!(g_res.pam_sites.iter().any(|s| s.nuclease == "SpCas9"));
    assert!(g_res.pam_sites.iter().any(|s| s.nuclease == "SaCas9"));
    assert!(g_res.pam_sites.iter().any(|s| s.nuclease == "Cas12a"));
}

#[test]
fn test_chemistry_smiles_molecules() {
    let azm =
        analyze_molecule_smiles(Some("Acetazolamide"), "CC(=O)Nc1nnc(S(N)(=O)=O)s1").unwrap();
    assert_eq!(azm.formula, "C4H6N4O3S2");
    assert_eq!(azm.heavy_atom_count, 13);
    assert_eq!(azm.ring_count, 1);
    assert_eq!(azm.aromatic_atom_count, 5);
    assert_eq!(azm.hbd, 2);
    assert!((azm.molecular_weight - 222.24).abs() < 0.2);
    assert_eq!(azm.atoms.len(), 13);
    assert_eq!(azm.bonds.len(), 13);

    let aspirin =
        analyze_molecule_smiles(Some("Aspirin"), "CC(=O)Oc1ccccc1C(=O)O").unwrap();
    assert_eq!(aspirin.formula, "C9H8O4");
    assert_eq!(aspirin.ring_count, 1);

    let caffeine =
        analyze_molecule_smiles(Some("Caffeine"), "Cn1cnc2c1c(=O)n(C)c(=O)n2C").unwrap();
    assert_eq!(caffeine.formula, "C8H10N4O2");
    assert_eq!(caffeine.ring_count, 2);

    let bsa = analyze_molecule_smiles(Some("Benzene sulfonamide"), "NS(=O)(=O)c1ccccc1").unwrap();
    assert_eq!(bsa.formula, "C6H7NO2S");
    assert_eq!(bsa.ring_count, 1);
}

#[test]
fn test_ramachandran_3hs4_and_af_p00918_cif() {
    let ref_cif = std::fs::read_to_string(fixture_path("3HS4.cif")).unwrap();
    let af_cif = std::fs::read_to_string(fixture_path("AF-P00918-F1-model_v6.cif")).unwrap();

    let res_3hs4 = analyze_ramachandran(&ref_cif, None).unwrap();
    assert_eq!(res_3hs4.chain_id, "A");
    assert_eq!(res_3hs4.residues.len(), 257);
    assert_eq!(res_3hs4.residues.first().unwrap().seq_id, 4);
    assert!(res_3hs4.residues.first().unwrap().phi_deg.is_none());
    assert!(res_3hs4.residues.first().unwrap().psi_deg.is_some());
    assert_eq!(
        res_3hs4.residues.first().unwrap().region,
        RamachandranRegion::Terminal
    );
    assert_eq!(res_3hs4.residues.last().unwrap().seq_id, 261);
    assert!(res_3hs4.residues.last().unwrap().phi_deg.is_some());
    assert!(res_3hs4.residues.last().unwrap().psi_deg.is_none());
    assert_eq!(
        res_3hs4.residues.last().unwrap().region,
        RamachandranRegion::Terminal
    );

    // Every non-terminal residue in 3HS4 has both phi and psi in [-180, 180]
    let terminal_count_3hs4 = res_3hs4
        .residues
        .iter()
        .filter(|r| r.region == RamachandranRegion::Terminal)
        .count();
    assert_eq!(terminal_count_3hs4, 2);
    for r in &res_3hs4.residues {
        if let Some(phi) = r.phi_deg {
            assert!((-180.0..=180.0).contains(&phi));
        }
        if let Some(psi) = r.psi_deg {
            assert!((-180.0..=180.0).contains(&psi));
        }
    }
    assert_eq!(
        res_3hs4.secondary_counts.helix
            + res_3hs4.secondary_counts.sheet
            + res_3hs4.secondary_counts.loop_count,
        257
    );
    assert!(res_3hs4.secondary_counts.sheet > res_3hs4.secondary_counts.helix);
    assert_eq!(
        res_3hs4.region_counts.favored
            + res_3hs4.region_counts.allowed
            + res_3hs4.region_counts.outlier
            + terminal_count_3hs4,
        257
    );
    assert!(res_3hs4.region_counts.favored >= 220);
    assert!(!res_3hs4.contact_pairs.is_empty());
    assert!(res_3hs4
        .contact_pairs
        .iter()
        .all(|(i, j, d)| *j > *i && (*j - *i) >= 4 && *d <= 8.0));

    let res_af = analyze_ramachandran(&af_cif, Some("A")).unwrap();
    assert_eq!(res_af.chain_id, "A");
    assert_eq!(res_af.residues.len(), 260);
    assert_eq!(
        res_af.secondary_counts.helix
            + res_af.secondary_counts.sheet
            + res_af.secondary_counts.loop_count,
        260
    );
    let terminal_count_af = res_af
        .residues
        .iter()
        .filter(|r| r.region == RamachandranRegion::Terminal)
        .count();
    assert_eq!(terminal_count_af, 2);
    assert_eq!(
        res_af.region_counts.favored
            + res_af.region_counts.allowed
            + res_af.region_counts.outlier
            + terminal_count_af,
        260
    );
    assert!(res_af.region_counts.favored >= 225);
    assert!(!res_af.contact_pairs.is_empty());

    let json_text = res_3hs4.to_json().to_json_string();
    let parsed = parse_json(&json_text).unwrap();
    assert_eq!(parsed.get("residueCount").and_then(|v| v.as_usize()), Some(257));
    assert_eq!(
        parsed
            .get("secondaryCounts")
            .and_then(|v| v.get("sheet"))
            .and_then(|v| v.as_usize()),
        Some(res_3hs4.secondary_counts.sheet)
    );
    assert_eq!(
        parsed
            .get("regionCounts")
            .and_then(|v| v.get("favored"))
            .and_then(|v| v.as_usize()),
        Some(res_3hs4.region_counts.favored)
    );
    assert!(parsed.get("ruoNotice").and_then(|v| v.as_str()).is_some());
}

#[test]
fn test_ramachandran_dihedral_chain_break_and_ambiguous_chain() {
    let angle_90 = dihedral_deg(
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 1.0, 1.0],
    )
    .unwrap();
    assert!((angle_90 - 90.0).abs() < 1e-9);

    let angle_neg90 = dihedral_deg(
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, -1.0, 1.0],
    )
    .unwrap();
    assert!((angle_neg90 + 90.0).abs() < 1e-9);

    // Two-chain PDB with a chain break between residue 2 and 3 in chain B
    let pdb = "\
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 10.00           N  
ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 10.00           C  
ATOM      3  C   ALA A   1       2.009   1.420   0.000  1.00 10.00           C  
ATOM      4  N   ALA B   1       0.000   0.000   0.000  1.00 10.00           N  
ATOM      5  CA  ALA B   1       1.458   0.000   0.000  1.00 10.00           C  
ATOM      6  C   ALA B   1       2.009   1.420   0.000  1.00 10.00           C  
ATOM      7  N   GLY B   2       1.450   2.550   0.500  1.00 10.00           N  
ATOM      8  CA  GLY B   2       1.950   3.850   0.950  1.00 10.00           C  
ATOM      9  C   GLY B   2       3.400   3.950   1.350  1.00 10.00           C  
ATOM     10  N   VAL B   5      20.000  20.000  20.000  1.00 10.00           N  
ATOM     11  CA  VAL B   5      21.450  20.000  20.000  1.00 10.00           C  
ATOM     12  C   VAL B   5      22.000  21.400  20.000  1.00 10.00           C  
";
    let err = analyze_ramachandran(pdb, None).unwrap_err();
    assert_eq!(err.code, "ERR_AMBIGUOUS_CHAIN");

    let res_b = analyze_ramachandran(pdb, Some("B")).unwrap();
    assert_eq!(res_b.chain_id, "B");
    assert_eq!(res_b.residues.len(), 3);
    // Residue 1 -> 2 is continuous (C-N distance ~1.36 A <= 2.5 A)
    assert!(res_b.residues[0].phi_deg.is_none());
    assert!(res_b.residues[0].psi_deg.is_some());
    assert!(res_b.residues[1].phi_deg.is_some());
    // Residue 2 -> 5 has a chain break (> 2.5 A), so psi of 2 and phi of 5 are null
    assert!(res_b.residues[1].psi_deg.is_none());
    assert_eq!(res_b.residues[1].region, RamachandranRegion::Terminal);
    assert!(res_b.residues[2].phi_deg.is_none());
    assert!(res_b.residues[2].psi_deg.is_none());
    assert_eq!(res_b.residues[2].region, RamachandranRegion::Terminal);
}
