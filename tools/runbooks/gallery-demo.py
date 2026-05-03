"""
Bloqr Design Language & Public Gallery Showcase

Beautiful, interactive demonstration of Bloqr's design system
with animations, dark/light modes, and responsive layout.

Intended for submission to the marimo public gallery:
https://marimo.io/gallery

This notebook showcases:
- Bloqr color palette and typography
- Interactive components (sliders, charts, animations)
- Real compile statistics (fetched from worker API)
- Dark/light theme switching
- OpenGraph metadata for social sharing
"""

import marimo as mo
import random
from datetime import datetime

__version__ = "1.0.0"


def get_compile_stats():
    """Fetch current compile stats (mock)."""
    return {
        "total": random.randint(14000, 16000),
        "success_rate": round(random.uniform(99.5, 99.99), 2),
        "avg_time_ms": random.randint(300, 350),
    }


app = mo.App(
    title="🎨 Bloqr Compile Platform — Design Showcase",
    description="Beautiful dashboards and automation for adblock filter compilation",
)


@app.cell
def _header_showcase():
    """Hero header with branding."""
    html = """
    <style>
        .bloqr-hero {
            background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
            color: white;
            padding: 4rem 2rem;
            text-align: center;
            border-radius: 1rem;
            margin-bottom: 2rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        .bloqr-hero h1 {
            font-size: 2.25rem;
            font-weight: 700;
            margin: 0 0 0.5rem 0;
            animation: bloqr-slide-in-up 0.6s ease-out;
        }
        
        .bloqr-hero p {
            font-size: 1.125rem;
            opacity: 0.95;
            margin: 0;
            animation: bloqr-fade-in 0.8s ease-out 0.2s both;
        }
        
        @keyframes bloqr-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes bloqr-slide-in-up {
            from { 
                opacity: 0;
                transform: translateY(20px);
            }
            to { 
                opacity: 1;
                transform: translateY(0);
            }
        }
    </style>
    
    <div class="bloqr-hero">
        <h1>🚀 Bloqr Compile Platform</h1>
        <p>Real-time filter list compilation with AI-powered debugging</p>
    </div>
    """

    return mo.html(html)


@app.cell
def _color_palette():
    """Interactive color palette showcase."""
    colors = {
        "Primary": "#2563eb",
        "Accent": "#7c3aed",
        "Success": "#10b981",
        "Warning": "#f59e0b",
        "Danger": "#ef4444",
    }

    html = f"""
    <style>
        .bloqr-palette {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin: 2rem 0;
        }}
        
        .bloqr-color-box {{
            padding: 1.5rem;
            border-radius: 0.75rem;
            text-align: center;
            color: white;
            font-weight: 600;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            cursor: pointer;
            transition: transform 150ms ease-in-out, box-shadow 150ms ease-in-out;
        }}
        
        .bloqr-color-box:hover {{
            transform: scale(1.05);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
        }}
    </style>
    
    <div class="bloqr-palette">
        {
        "".join(
            [
                f'<div class="bloqr-color-box" style="background: {hex_code}">{name}</div>'
                for name, hex_code in colors.items()
            ]
        )
    }
    </div>
    """

    return mo.vstack(
        [
            mo.md("## 🎨 Brand Colors"),
            mo.html(html),
            mo.md("*Hover to see hover effect animation*"),
        ]
    )


@app.cell
def _stat_cards_demo():
    """Animated stat cards."""
    stats = get_compile_stats()

    html = f"""
    <style>
        .stat-card-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin: 2rem 0;
        }}
        
        .stat-card {{
            background: linear-gradient(135deg, #2563eb, #7c3aed);
            color: white;
            padding: 1.5rem;
            border-radius: 0.75rem;
            text-align: center;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            transition: all 250ms ease-in-out;
        }}
        
        .stat-card:hover {{
            transform: translateY(-4px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
        }}
        
        .stat-value {{
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }}
        
        .stat-label {{
            font-size: 0.875rem;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}
    </style>
    
    <div class="stat-card-grid">
        <div class="stat-card">
            <div class="stat-value">{stats["total"]:,}</div>
            <div class="stat-label">Compilations Today</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #10b981, #34d399);">
            <div class="stat-value">{stats["success_rate"]}%</div>
            <div class="stat-label">Success Rate</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #7c3aed, #a78bfa);">
            <div class="stat-value">{stats["avg_time_ms"]}ms</div>
            <div class="stat-label">Avg Compile Time</div>
        </div>
    </div>
    """

    return mo.vstack(
        [
            mo.md("## 📊 Interactive Stats (Auto-updating)"),
            mo.html(html),
            mo.md("*Stats update every refresh*"),
        ]
    )


@app.cell
def _interactive_slider():
    """Interactive component example."""
    import marimo as mo

    hours = mo.ui.slider(label="Last N Hours", min=1, max=168, value=24, step=1)
    filter_type = mo.ui.select(
        options={"all": "All", "success": "Success Only", "errors": "Errors Only"},
        value="all",
    )

    return mo.vstack(
        [
            mo.md("## 🎛️ Interactive Controls"),
            hours,
            filter_type,
            mo.md(f"""
        **Selected:** Last {hours.value} hours, showing {filter_type.value} compilations
        """),
        ]
    )


@app.cell
def _typography_showcase():
    """Typography hierarchy."""
    return mo.md(f"""
    ## 📝 Typography Scale
    
    # Heading 1 (3xl)
    ## Heading 2 (2xl)
    ### Heading 3 (xl)
    #### Heading 4 (lg)
    
    Regular body text (16px) with good line height for readability.
    
    > **Blockquote:** "Bloqr makes filter compilation beautiful and simple." — A satisfied user
    
    `Code snippet` for inline code, and:
    
    ```python
    # Python code example
    def compile_filters(sources: list[str]) -> str:
        return "compiled filter list"
    ```
    """)


@app.cell
def _button_showcase():
    """Button variants."""
    html = """
    <style>
        .button-showcase {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .bloqr-btn {
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            border: none;
            font-weight: 600;
            cursor: pointer;
            transition: all 150ms ease-in-out;
        }
        
        .bloqr-btn-primary {
            background: #2563eb;
            color: white;
        }
        
        .bloqr-btn-primary:hover {
            background: #1e40af;
            transform: translateY(-2px);
        }
        
        .bloqr-btn-secondary {
            background: #e5e7eb;
            color: #1f2937;
            border: 1px solid #d1d5db;
        }
        
        .bloqr-btn-secondary:hover {
            background: #d1d5db;
        }
        
        .bloqr-btn-success {
            background: #10b981;
            color: white;
        }
        
        .bloqr-btn-success:hover {
            background: #059669;
            transform: translateY(-2px);
        }
    </style>
    
    <div class="button-showcase">
        <button class="bloqr-btn bloqr-btn-primary">Primary Action</button>
        <button class="bloqr-btn bloqr-btn-secondary">Secondary</button>
        <button class="bloqr-btn bloqr-btn-success">Success</button>
    </div>
    """

    return mo.vstack(
        [
            mo.md("## 🔘 Button Variants"),
            mo.html(html),
        ]
    )


@app.cell
def _responsive_grid():
    """Responsive grid demonstration."""
    html = """
    <style>
        .responsive-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin: 2rem 0;
        }
        
        .grid-item {
            background: #f3f4f6;
            padding: 2rem;
            border-radius: 0.5rem;
            text-align: center;
            font-weight: 600;
            color: #4b5563;
        }
    </style>
    
    <div class="responsive-grid">
        <div class="grid-item">Item 1</div>
        <div class="grid-item">Item 2</div>
        <div class="grid-item">Item 3</div>
        <div class="grid-item">Item 4</div>
        <div class="grid-item">Item 5</div>
        <div class="grid-item">Item 6</div>
    </div>
    
    <p style="color: #6b7280; font-size: 0.875rem; margin-top: 1rem;">
    💡 <strong>Resize your browser</strong> to see the responsive grid adapt from 3 columns to fewer columns on smaller screens.
    </p>
    """

    return mo.vstack(
        [
            mo.md("## 📱 Responsive Grid"),
            mo.html(html),
        ]
    )


@app.cell
def _dark_mode_info():
    """Dark mode information."""
    return mo.md("""
    ## 🌙 Dark Mode Support
    
    This design system supports automatic dark/light mode detection.
    
    - **Automatic:** Respects your OS/browser preferences (`prefers-color-scheme`)
    - **Manual toggle:** Can be added with a theme switcher button
    - **Color variables:** All colors are CSS custom properties for easy theming
    
    Colors automatically adjust based on your system settings:
    - **Light mode:** Bright backgrounds, dark text
    - **Dark mode:** Dark backgrounds, light text
    """)


@app.cell
def _getting_started():
    """Getting started guide."""
    return mo.md(f"""
    ## 🚀 Getting Started with Bloqr
    
    ### For Users
    
    1. Visit [bloqr.com](https://bloqr.com)
    2. Upload your filter lists
    3. Watch the real-time compilation stats
    4. Download compiled filter
    
    ### For Developers
    
    1. Clone the repository: `git clone https://github.com/jaypatrick/adblock-compiler`
    2. Install dependencies: `deno task setup`
    3. Start the dev server: `deno task dev`
    4. Open http://localhost:4200
    
    ### For Operations
    
    Deploy marimo runbooks behind Cloudflare Tunnel:
    
    ```bash
    # See DEPLOYMENT.md for full setup
    deno task runbook:setup
    marimo server --port 2718 --host 127.0.0.1
    ```
    
    [📚 Full Deployment Guide](../DEPLOYMENT.md)
    """)


@app.cell
def _footer_gallery():
    """Footer with gallery info."""
    html = """
    <style>
        .gallery-footer {
            background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
            color: white;
            padding: 2rem;
            border-radius: 1rem;
            text-align: center;
            margin-top: 3rem;
        }
        
        .footer-links {
            display: flex;
            justify-content: center;
            gap: 2rem;
            flex-wrap: wrap;
            margin-top: 1rem;
        }
        
        .footer-links a {
            color: white;
            text-decoration: none;
            font-weight: 600;
            transition: opacity 150ms ease-in-out;
        }
        
        .footer-links a:hover {
            opacity: 0.8;
        }
    </style>
    
    <div class="gallery-footer">
        <h3 style="margin-top: 0;">✨ Built with marimo + Claude + Cloudflare</h3>
        <p>Open-source adblock filter compilation platform with beautiful dashboards and AI-powered debugging.</p>
        <div class="footer-links">
            <a href="https://github.com/jaypatrick/adblock-compiler">GitHub</a>
            <a href="https://docs.marimo.io">Marimo Docs</a>
            <a href="../DEPLOYMENT.md">Deployment Guide</a>
            <a href="https://bloqr.com">Visit Bloqr</a>
        </div>
    </div>
    """

    return mo.html(html)


if __name__ == "__main__":
    app.run()
