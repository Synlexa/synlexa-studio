#include "synlexa/bio_core.hpp"

#include <fstream>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>

namespace {

std::string read_file(const std::string& path) {
    std::ifstream ifs(path, std::ios::binary);
    if (!ifs) {
        throw synlexa::bio::CoreError("ERR_INVALID_INPUT", "Failed to read file: " + path);
    }
    std::ostringstream ss;
    ss << ifs.rdbuf();
    return ss.str();
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 2 || std::string(argv[1]) != "compare") {
        std::cerr << "Usage: studio-cli-cpp compare --ref <path> [--ref-chain <id>] --mob <path> [--mob-chain <id>] [--pae <path>] [--out <path>]\n";
        return 1;
    }

    std::optional<std::string> ref_path, mob_path, ref_chain, mob_chain, pae_path, out_path;
    for (int i = 2; i + 1 < argc; ++i) {
        std::string flag = argv[i];
        if (flag == "--ref") ref_path = argv[++i];
        else if (flag == "--mob") mob_path = argv[++i];
        else if (flag == "--ref-chain") ref_chain = argv[++i];
        else if (flag == "--mob-chain") mob_chain = argv[++i];
        else if (flag == "--pae") pae_path = argv[++i];
        else if (flag == "--out") out_path = argv[++i];
    }

    try {
        if (!ref_path || !mob_path) {
            throw synlexa::bio::CoreError("ERR_INVALID_INPUT", "Missing --ref or --mob path");
        }
        auto ref_struct = synlexa::bio::parse_structure(read_file(*ref_path));
        auto mob_struct = synlexa::bio::parse_structure(read_file(*mob_path));
        std::optional<std::string> pae_str;
        if (pae_path) pae_str = read_file(*pae_path);

        auto res = synlexa::bio::compare_structures(
            *ref_path, ref_struct, ref_chain,
            *mob_path, mob_struct, mob_chain, pae_str);
        std::string json = res.to_json();
        if (out_path) {
            std::ofstream ofs(*out_path, std::ios::binary);
            ofs << json;
        } else {
            std::cout << json << "\n";
        }
        return 0;
    } catch (const synlexa::bio::CoreError& e) {
        std::cerr << "{\"ok\":false,\"error\":{\"code\":\"" << e.code << "\",\"message\":\"" << e.what() << "\"}}\n";
        return 1;
    }
}
