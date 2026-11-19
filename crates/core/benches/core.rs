//! Benchmarks for the hot paths: parse/analyze, size splitting, the full
//! optimization pipeline and the health score.
//!
//! The input is generated (Tailwind-like utilities, media variants, custom
//! properties, keyframes) so no large fixture needs committing. Run with:
//! `cargo bench -p css_doctor_core`.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};

use css_doctor_core::{
    HealthScoreConfig, PageCoverageConfig, PipelineInput, SizeBudgetConfig, SizeSplitterConfig,
    analyze_css, evaluate_css_health, optimize_css_pipeline, split_css_by_size,
};

/// Builds roughly `target_bytes` of utility-style CSS.
fn generate_css(target_bytes: usize) -> String {
    let mut css = String::with_capacity(target_bytes + 1024);
    css.push_str(":root { --brand: #3366ff; --space: 4px; --radius: 6px; }\n");
    css.push_str(
        "@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }\n",
    );
    css.push_str(
        "@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }\n",
    );
    css.push_str("*, ::before, ::after { box-sizing: border-box; }\n");

    let mut index = 0usize;
    while css.len() < target_bytes {
        let _ = writeln!(
            css,
            ".u-{index} {{ margin: {m}px; padding: {p}px; color: #{c:06x}; background: var(--brand); }}",
            m = index % 64,
            p = (index * 3) % 48,
            c = (index * 2654435761) % 0xFF_FFFF,
        );
        if index % 5 == 0 {
            let _ = writeln!(
                css,
                "@media (min-width: {w}px) {{ .md\\:u-{index} {{ display: flex; gap: {g}px; }} }}",
                w = 480 + (index % 6) * 160,
                g = index % 24,
            );
        }
        if index % 7 == 0 {
            let _ = writeln!(
                css,
                ".u-{index}:hover, .u-{index}:focus-visible {{ opacity: .{o}; }}",
                o = index % 10
            );
        }
        if index % 11 == 0 {
            let _ = writeln!(
                css,
                ".card-{index} .title > .u-{index} {{ font-weight: 600; }}"
            );
        }
        index += 1;
    }
    css
}

fn page_usage(pages: usize, total_classes: usize) -> HashMap<String, HashSet<String>> {
    (0..pages)
        .map(|page| {
            let classes = (0..total_classes)
                .filter(|index| (index + page) % (pages + 1) != 0)
                .map(|index| format!("u-{index}"))
                .collect();
            (format!("page-{page}"), classes)
        })
        .collect()
}

fn benches(c: &mut Criterion) {
    let css = generate_css(300 * 1024);
    let usage = page_usage(4, 2_000);

    let mut group = c.benchmark_group("core-300KiB");
    group.sample_size(20);

    group.bench_function("analyze_css", |b| {
        b.iter(|| analyze_css(black_box(&css)).expect("analyze"));
    });

    group.bench_function("split_css_by_size/minify", |b| {
        let config = SizeSplitterConfig {
            max_chunk_size: 60 * 1024,
            isolate_variables: true,
            minify: true,
        };
        b.iter(|| split_css_by_size(black_box(&css), &config).expect("split"));
    });

    group.bench_function("split_css_by_size/readable", |b| {
        let config = SizeSplitterConfig {
            max_chunk_size: 60 * 1024,
            isolate_variables: true,
            minify: false,
        };
        b.iter(|| split_css_by_size(black_box(&css), &config).expect("split"));
    });

    group.bench_function("optimize_css_pipeline", |b| {
        let input = PipelineInput {
            css_content: css.clone(),
            page_usage: usage.clone(),
            page_coverage: PageCoverageConfig::default(),
            size_budget: SizeBudgetConfig::default(),
            minify: true,
        };
        b.iter(|| optimize_css_pipeline(black_box(&input)).expect("pipeline"));
    });

    group.bench_function("evaluate_css_health", |b| {
        let config = HealthScoreConfig::default();
        b.iter(|| {
            evaluate_css_health(black_box(&css), Some("bench.css"), Some(css.len()), &config)
                .expect("health")
        });
    });

    group.finish();
}

criterion_group!(core, benches);
criterion_main!(core);
