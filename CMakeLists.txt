cmake_minimum_required(VERSION 3.24)
project(synlexa_studio_cpp VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(synlexa_bio_cpp STATIC
  core/src/bio_core.cpp
)
target_include_directories(synlexa_bio_cpp PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/core/include
)
target_compile_options(synlexa_bio_cpp PRIVATE
  -Wall -Wextra -Wpedantic
)

add_executable(studio-cli-cpp
  tools/studio-cli/main.cpp
)
target_link_libraries(studio-cli-cpp PRIVATE synlexa_bio_cpp)
target_compile_options(studio-cli-cpp PRIVATE
  -Wall -Wextra -Wpedantic
)

enable_testing()
add_executable(synlexa_bio_cpp_tests
  core/tests/test_bio_core.cpp
)
target_link_libraries(synlexa_bio_cpp_tests PRIVATE synlexa_bio_cpp)
target_compile_definitions(synlexa_bio_cpp_tests PRIVATE
  SYNLEXA_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures"
)
target_compile_options(synlexa_bio_cpp_tests PRIVATE
  -Wall -Wextra -Wpedantic
)

add_test(NAME bio_core_cpp_suite COMMAND synlexa_bio_cpp_tests)
