#include <windows.h>
#include <windowsx.h>
#include <commdlg.h>
#include <propidl.h>
#include <gdiplus.h>
#include <mfapi.h>
#include <mfplay.h>

#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <filesystem>
#include <algorithm>
#include <sstream>
#include <memory>
#include <map>

using std::min;
using std::max;

#include "json.hpp"

using namespace Gdiplus;
namespace fs = std::filesystem;
using json = nlohmann::json;

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfplay.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "comdlg32.lib")

// Data Models
struct CastMember {
    std::wstring name;
    std::wstring role;
    std::wstring image; // relative or absolute path
};

struct Movie {
    std::wstring id;
    std::wstring fileName;
    std::wstring filePath;
    std::wstring title;
    std::wstring year;
    std::wstring rating;
    std::wstring genre;
    std::wstring collection;
    std::wstring tagline;
    std::wstring description;
    std::wstring poster;
    std::wstring banner;
    std::wstring titleImage;
    std::vector<CastMember> cast;
    std::wstring gmdPath;
};

// UI State
enum class AppView {
    Cinema,
    Music,
    Images,
    About
};

enum class OverlayState {
    None,
    DetailHub,
    EditorDrawer,
    Player
};

// Global Application Context
class GorillaFlixNativeApp {
public:
    HWND hwndMain = NULL;
    HWND hwndVideoHost = NULL;
    IMFPMediaPlayer* pPlayer = NULL;
    ULONG_PTR gdiplusToken = 0;

    fs::path rootDir;
    fs::path videosDir;
    fs::path musicDir;
    fs::path imagesDir;
    fs::path metadataDir;
    fs::path posterDir;
    fs::path bgDir;
    fs::path titleDir;
    fs::path castDir;
    fs::path positionsFile;

    std::vector<Movie> movies;
    std::vector<Movie> filteredMovies;
    Movie selectedMovie;
    Movie editingMovie;

    AppView currentView = AppView::Cinema;
    OverlayState overlay = OverlayState::None;

    std::wstring searchQuery = L"";
    std::wstring selectedGenre = L"";
    int sortMode = 0; // 0: Title A-Z, 1: Title Z-A, 2: Year Newest, 3: Year Oldest

    // UI Layout metrics
    int sidebarWidth = 220;
    int scrollOffsetY = 0;
    int maxScrollY = 0;
    std::map<std::wstring, Gdiplus::Bitmap*> imageCache;

    // Player State
    std::wstring currentPlayKey = L"";
    bool isPlaying = false;

    GorillaFlixNativeApp() {
        wchar_t exePath[MAX_PATH];
        GetModuleFileNameW(NULL, exePath, MAX_PATH);
        rootDir = fs::path(exePath).parent_path();

        videosDir = rootDir / L"Svideos";
        musicDir = rootDir / L"Smusic";
        imagesDir = rootDir / L"GorillaImages";
        metadataDir = rootDir / L"metadata";
        posterDir = metadataDir / L"images" / L"poster";
        bgDir = metadataDir / L"images" / L"bg";
        titleDir = metadataDir / L"images" / L"title";
        castDir = metadataDir / L"images" / L"cast";
        positionsFile = metadataDir / L"positions.json";
    }

    void initDirectories() {
        try {
            fs::create_directories(videosDir);
            fs::create_directories(musicDir);
            fs::create_directories(imagesDir);
            fs::create_directories(metadataDir);
            fs::create_directories(posterDir);
            fs::create_directories(bgDir);
            fs::create_directories(titleDir);
            fs::create_directories(castDir);
        } catch (...) {}
    }

    void migrateLegacy() {
        try {
            // Check legacy Gflix-metadata.cfg
            fs::path legacyCfg = rootDir / L"Gflix-metadata.cfg";
            if (fs::exists(legacyCfg)) {
                fs::path backupCfg = rootDir / L"Gflix-metadata.cfg.bak";
                fs::rename(legacyCfg, backupCfg);
            }

            // Move .gmd files from Svideos into metadata/
            if (fs::exists(videosDir)) {
                for (const auto& entry : fs::directory_iterator(videosDir)) {
                    if (entry.is_regular_file() && entry.path().extension() == L".gmd") {
                        fs::path dest = metadataDir / entry.path().filename();
                        fs::rename(entry.path(), dest);
                    }
                }
            }
        } catch (...) {}
    }

    std::string wstringToUtf8(const std::wstring& wstr) {
        if (wstr.empty()) return "";
        int size = WideCharToMultiByte(CP_UTF8, 0, &wstr[0], (int)wstr.size(), NULL, 0, NULL, NULL);
        std::string str(size, 0);
        WideCharToMultiByte(CP_UTF8, 0, &wstr[0], (int)wstr.size(), &str[0], size, NULL, NULL);
        return str;
    }

    std::wstring utf8ToWstring(const std::string& str) {
        if (str.empty()) return L"";
        int size = MultiByteToWideChar(CP_UTF8, 0, &str[0], (int)str.size(), NULL, 0);
        std::wstring wstr(size, 0);
        MultiByteToWideChar(CP_UTF8, 0, &str[0], (int)str.size(), &wstr[0], size);
        return wstr;
    }

    void scanLibrary() {
        movies.clear();
        initDirectories();
        migrateLegacy();

        if (!fs::exists(videosDir)) return;

        std::vector<std::wstring> videoExts = { L".mp4", L".mkv", L".webm", L".mov", L".avi" };

        for (const auto& entry : fs::directory_iterator(videosDir)) {
            if (!entry.is_regular_file()) continue;

            std::wstring ext = entry.path().extension().wstring();
            std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

            if (std::find(videoExts.begin(), videoExts.end(), ext) != videoExts.end()) {
                Movie m;
                m.fileName = entry.path().filename().wstring();
                m.filePath = entry.path().wstring();
                m.id = entry.path().stem().wstring();

                // GMD path in metadata/
                fs::path gmd = metadataDir / (entry.path().stem().wstring() + L".gmd");
                m.gmdPath = gmd.wstring();

                bool loaded = false;
                if (fs::exists(gmd)) {
                    try {
                        std::ifstream f(gmd);
                        json j;
                        f >> j;

                        m.title = utf8ToWstring(j.value("title", ""));
                        m.year = utf8ToWstring(j.value("year", ""));
                        m.rating = utf8ToWstring(j.value("rating", "G"));
                        m.genre = utf8ToWstring(j.value("genre", ""));
                        m.collection = utf8ToWstring(j.value("collection", ""));
                        m.tagline = utf8ToWstring(j.value("tagline", ""));
                        m.description = utf8ToWstring(j.value("description", ""));
                        m.poster = utf8ToWstring(j.value("poster", ""));
                        m.banner = utf8ToWstring(j.value("banner", ""));
                        m.titleImage = utf8ToWstring(j.value("titleImage", ""));

                        if (j.contains("cast") && j["cast"].is_array()) {
                            for (const auto& cj : j["cast"]) {
                                CastMember cm;
                                cm.name = utf8ToWstring(cj.value("name", ""));
                                cm.role = utf8ToWstring(cj.value("role", ""));
                                cm.image = utf8ToWstring(cj.value("image", ""));
                                m.cast.push_back(cm);
                            }
                        }
                        loaded = true;
                    } catch (...) {
                        // Corrupt GMD: quarantine as .gmd.bad
                        fs::path badPath = metadataDir / (entry.path().stem().wstring() + L".gmd.bad");
                        try { fs::rename(gmd, badPath); } catch (...) {}
                    }
                }

                if (!loaded) {
                    // Auto-create missing GMD
                    std::wstring baseTitle = entry.path().stem().wstring();
                    std::wstring parsedYear = L"2026";
                    size_t p1 = baseTitle.rfind(L'(');
                    size_t p2 = baseTitle.rfind(L')');
                    if (p1 != std::wstring::npos && p2 != std::wstring::npos && p2 > p1) {
                        parsedYear = baseTitle.substr(p1 + 1, p2 - p1 - 1);
                        baseTitle = baseTitle.substr(0, p1);
                        while (!baseTitle.empty() && baseTitle.back() == L' ') baseTitle.pop_back();
                    }

                    m.title = baseTitle.empty() ? entry.path().stem().wstring() : baseTitle;
                    m.year = parsedYear;
                    m.rating = L"G";
                    m.genre = L"";
                    m.collection = L"";

                    saveMovieGmd(m);
                }

                movies.push_back(m);
            }
        }

        applyFilters();
    }

    void saveMovieGmd(const Movie& m) {
        try {
            json j;
            j["title"] = wstringToUtf8(m.title);
            j["year"] = wstringToUtf8(m.year);
            j["rating"] = wstringToUtf8(m.rating);
            j["genre"] = wstringToUtf8(m.genre);
            j["collection"] = wstringToUtf8(m.collection);
            j["tagline"] = wstringToUtf8(m.tagline);
            j["description"] = wstringToUtf8(m.description);
            j["poster"] = wstringToUtf8(m.poster);
            j["banner"] = wstringToUtf8(m.banner);
            j["titleImage"] = wstringToUtf8(m.titleImage);

            json castArray = json::array();
            for (const auto& c : m.cast) {
                json cj;
                cj["name"] = wstringToUtf8(c.name);
                cj["role"] = wstringToUtf8(c.role);
                cj["image"] = wstringToUtf8(c.image);
                castArray.push_back(cj);
            }
            j["cast"] = castArray;

            fs::path dest = m.gmdPath.empty() ? (metadataDir / (m.id + L".gmd")) : fs::path(m.gmdPath);
            std::ofstream f(dest);
            f << j.dump(2);
        } catch (...) {}
    }

    void rebuildMissing() {
        for (auto& m : movies) {
            fs::path gmd = metadataDir / (m.id + L".gmd");
            if (!fs::exists(gmd)) {
                saveMovieGmd(m);
            }
        }
        scanLibrary();
    }

    void applyFilters() {
        filteredMovies.clear();
        for (const auto& m : movies) {
            bool matchesQuery = true;
            if (!searchQuery.empty()) {
                std::wstring q = searchQuery;
                std::transform(q.begin(), q.end(), q.begin(), ::tolower);

                std::wstring t = m.title;
                std::transform(t.begin(), t.end(), t.begin(), ::tolower);

                std::wstring y = m.year;
                std::wstring g = m.genre;
                std::transform(g.begin(), g.end(), g.begin(), ::tolower);

                matchesQuery = (t.find(q) != std::wstring::npos ||
                                y.find(q) != std::wstring::npos ||
                                g.find(q) != std::wstring::npos);
            }

            bool matchesGenre = true;
            if (!selectedGenre.empty()) {
                matchesGenre = (m.genre.find(selectedGenre) != std::wstring::npos);
            }

            if (matchesQuery && matchesGenre) {
                filteredMovies.push_back(m);
            }
        }

        // Sort
        std::sort(filteredMovies.begin(), filteredMovies.end(), [this](const Movie& a, const Movie& b) {
            if (sortMode == 0) return a.title < b.title;
            if (sortMode == 1) return a.title > b.title;
            if (sortMode == 2) return a.year > b.year;
            if (sortMode == 3) return a.year < b.year;
            return a.title < b.title;
        });

        if (hwndMain) InvalidateRect(hwndMain, NULL, FALSE);
    }

    Gdiplus::Bitmap* getImage(const std::wstring& relOrAbsPath) {
        if (relOrAbsPath.empty()) return nullptr;
        if (imageCache.find(relOrAbsPath) != imageCache.end()) {
            return imageCache[relOrAbsPath];
        }

        fs::path p = relOrAbsPath;
        if (p.is_relative()) {
            p = rootDir / p;
        }

        if (fs::exists(p)) {
            Gdiplus::Bitmap* bmp = new Gdiplus::Bitmap(p.c_str());
            if (bmp && bmp->GetLastStatus() == Gdiplus::Ok) {
                imageCache[relOrAbsPath] = bmp;
                return bmp;
            }
            if (bmp) delete bmp;
        }
        return nullptr;
    }

    // Media Foundation Playback
    void startPlayback(const Movie& m) {
        selectedMovie = m;
        currentPlayKey = m.id;

        HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        MFStartup(MF_VERSION);

        if (pPlayer) {
            pPlayer->Shutdown();
            pPlayer->Release();
            pPlayer = NULL;
        }

        RECT rc;
        GetClientRect(hwndMain, &rc);
        int w = rc.right - sidebarWidth;
        int h = rc.bottom;

        if (!hwndVideoHost) {
            hwndVideoHost = CreateWindowExW(
                0, L"STATIC", L"",
                WS_CHILD | WS_VISIBLE,
                sidebarWidth, 0, w, h,
                hwndMain, NULL, GetModuleHandle(NULL), NULL
            );
        } else {
            MoveWindow(hwndVideoHost, sidebarWidth, 0, w, h, TRUE);
            ShowWindow(hwndVideoHost, SW_SHOW);
        }

        hr = MFPCreateMediaPlayer(
            m.filePath.c_str(),
            TRUE, // fStartPlayback
            0,
            NULL,
            hwndVideoHost,
            &pPlayer
        );

        if (SUCCEEDED(hr)) {
            overlay = OverlayState::Player;
            isPlaying = true;

            // Load saved position
            try {
                if (fs::exists(positionsFile)) {
                    std::ifstream f(positionsFile);
                    json j;
                    f >> j;
                    std::string key = wstringToUtf8(m.id);
                    if (j.contains(key)) {
                        double posSec = j[key].get<double>();
                        if (posSec > 5.0) {
                            PROPVARIANT var;
                            PropVariantInit(&var);
                            var.vt = VT_I8;
                            var.hVal.QuadPart = (LONGLONG)(posSec * 10000000.0);
                            pPlayer->SetPosition(MFP_POSITIONTYPE_100NS, &var);
                            PropVariantClear(&var);
                        }
                    }
                }
            } catch (...) {}
        }

        InvalidateRect(hwndMain, NULL, FALSE);
    }

    void stopPlayback() {
        if (pPlayer) {
            // Save position
            try {
                PROPVARIANT var;
                PropVariantInit(&var);
                if (SUCCEEDED(pPlayer->GetPosition(MFP_POSITIONTYPE_100NS, &var))) {
                    double sec = (double)var.hVal.QuadPart / 10000000.0;
                    if (sec > 5.0) {
                        json j;
                        if (fs::exists(positionsFile)) {
                            try { std::ifstream f(positionsFile); f >> j; } catch (...) {}
                        }
                        j[wstringToUtf8(currentPlayKey)] = sec;
                        std::ofstream f(positionsFile);
                        f << j.dump(2);
                    }
                    PropVariantClear(&var);
                }
            } catch (...) {}

            pPlayer->Shutdown();
            pPlayer->Release();
            pPlayer = NULL;
        }

        if (hwndVideoHost) {
            ShowWindow(hwndVideoHost, SW_HIDE);
        }

        isPlaying = false;
        overlay = OverlayState::DetailHub;
        InvalidateRect(hwndMain, NULL, FALSE);
    }

    // Native File Dialog
    std::wstring openFileDialog(const wchar_t* filter) {
        wchar_t filename[MAX_PATH] = L"";
        OPENFILENAMEW ofn = {0};
        ofn.lStructSize = sizeof(ofn);
        ofn.hwndOwner = hwndMain;
        ofn.lpstrFilter = filter;
        ofn.lpstrFile = filename;
        ofn.nMaxFile = MAX_PATH;
        ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
        if (GetOpenFileNameW(&ofn)) {
            return std::wstring(filename);
        }
        return L"";
    }

    std::wstring copyArtToFolder(const std::wstring& srcPath, const fs::path& targetFolder) {
        try {
            fs::path src(srcPath);
            fs::path dest = targetFolder / src.filename();
            fs::copy_file(src, dest, fs::copy_options::overwrite_existing);
            return fs::relative(dest, rootDir).wstring();
        } catch (...) {
            return srcPath;
        }
    }
};

GorillaFlixNativeApp g_App;

// Double-buffered Win32 painting
void OnPaint(HWND hwnd) {
    PAINTSTRUCT ps;
    HDC hdc = BeginPaint(hwnd, &ps);

    RECT rc;
    GetClientRect(hwnd, &rc);
    int width = rc.right - rc.left;
    int height = rc.bottom - rc.top;

    HDC memDC = CreateCompatibleDC(hdc);
    HBITMAP memBitmap = CreateCompatibleBitmap(hdc, width, height);
    HBITMAP oldBitmap = (HBITMAP)SelectObject(memDC, memBitmap);

    Graphics g(memDC);
    g.SetSmoothingMode(SmoothingModeAntiAlias);
    g.SetTextRenderingHint(TextRenderingHintClearTypeGridFit);

    // 1. Background
    SolidBrush bgBrush(Color(255, 6, 4, 10)); // #06040a
    g.FillRectangle(&bgBrush, 0, 0, width, height);

    // 2. Sidebar (#0d0b14)
    SolidBrush sidebarBrush(Color(255, 13, 11, 20));
    g.FillRectangle(&sidebarBrush, 0, 0, g_App.sidebarWidth, height);

    Pen borderPen(Color(255, 30, 26, 40));
    g.DrawLine(&borderPen, g_App.sidebarWidth, 0, g_App.sidebarWidth, height);

    // Logo & Title
    FontFamily fontFamily(L"Segoe UI");
    Font logoFont(&fontFamily, 22, FontStyleBold, UnitPixel);
    Font subFont(&fontFamily, 11, FontStyleRegular, UnitPixel);
    Font navFont(&fontFamily, 14, FontStyleBold, UnitPixel);
    Font cardFont(&fontFamily, 13, FontStyleBold, UnitPixel);
    Font cardSubFont(&fontFamily, 11, FontStyleRegular, UnitPixel);

    SolidBrush redBrush(Color(255, 255, 42, 59)); // #ff2a3b
    SolidBrush whiteBrush(Color(255, 255, 255, 255));
    SolidBrush grayBrush(Color(255, 140, 140, 150));
    SolidBrush activeNavBg(Color(255, 35, 15, 25));

    g.DrawString(L"GorillaFlix", -1, &logoFont, PointF(30, 30), &redBrush);
    g.DrawString(L"MEDIA HUB 2.0", -1, &subFont, PointF(30, 60), &grayBrush);

    // Nav Items
    const wchar_t* navLabels[] = { L"  Movies", L"  Music", L"  Images", L"  About" };
    for (int i = 0; i < 4; i++) {
        int navY = 110 + i * 46;
        bool isActive = ((int)g_App.currentView == i);
        if (isActive) {
            g.FillRectangle(&activeNavBg, 0, navY, g_App.sidebarWidth, 42);
            SolidBrush accentBar(Color(255, 255, 42, 59));
            g.FillRectangle(&accentBar, 0, navY, 4, 42);
            g.DrawString(navLabels[i], -1, &navFont, PointF(30, (REAL)navY + 11), &redBrush);
        } else {
            g.DrawString(navLabels[i], -1, &navFont, PointF(30, (REAL)navY + 11), &grayBrush);
        }
    }

    // Status bar at bottom
    SolidBrush statusBg(Color(255, 13, 11, 20));
    g.FillRectangle(&statusBg, g_App.sidebarWidth, height - 24, width - g_App.sidebarWidth, 24);
    g.DrawLine(&borderPen, g_App.sidebarWidth, height - 24, width, height - 24);
    g.DrawString(L"Local Media System Ready", -1, &subFont, PointF((REAL)g_App.sidebarWidth + 20, (REAL)height - 18), &grayBrush);

    std::wstring countStr = std::to_wstring(g_App.filteredMovies.size()) + L" movies loaded";
    g.DrawString(countStr.c_str(), -1, &subFont, PointF((REAL)width - 150, (REAL)height - 18), &redBrush);

    // 3. Cinema View: Top Controls & Poster Grid
    if (g_App.currentView == AppView::Cinema && g_App.overlay == OverlayState::None) {
        int mainX = g_App.sidebarWidth + 36;
        int mainY = 32 - g_App.scrollOffsetY;

        Font titleFont(&fontFamily, 26, FontStyleBold, UnitPixel);
        g.DrawString(L"Cinema", -1, &titleFont, PointF((REAL)mainX, (REAL)mainY), &whiteBrush);

        // Header Buttons: Rebuild, Refresh, Add
        SolidBrush btnBg(Color(255, 30, 26, 42));
        g.FillRectangle(&btnBg, width - 420, mainY + 4, 120, 32);
        g.DrawString(L"Rebuild GMD", -1, &subFont, PointF((REAL)width - 400, (REAL)mainY + 12), &whiteBrush);

        g.FillRectangle(&btnBg, width - 290, mainY + 4, 100, 32);
        g.DrawString(L"Refresh", -1, &subFont, PointF((REAL)width - 265, (REAL)mainY + 12), &whiteBrush);

        g.FillRectangle(&redBrush, width - 180, mainY + 4, 130, 32);
        g.DrawString(L"+ Add Movie", -1, &subFont, PointF((REAL)width - 155, (REAL)mainY + 12), &whiteBrush);

        // Grid
        int startY = mainY + 60;
        int cardW = 170;
        int cardH = 260;
        int gap = 24;
        int cols = max(1, (width - mainX - 40) / (cardW + gap));

        SolidBrush cardBg(Color(255, 20, 18, 30));
        Pen cardBorder(Color(255, 45, 40, 60));

        for (size_t i = 0; i < g_App.filteredMovies.size(); i++) {
            int col = (int)i % cols;
            int row = (int)i / cols;
            int cx = mainX + col * (cardW + gap);
            int cy = startY + row * (cardH + gap);

            if (cy + cardH < 0 || cy > height) continue; // frustum culling

            g.FillRectangle(&cardBg, cx, cy, cardW, cardH);
            g.DrawRectangle(&cardBorder, cx, cy, cardW, cardH);

            // Draw Poster
            Gdiplus::Bitmap* poster = g_App.getImage(g_App.filteredMovies[i].poster);
            if (poster) {
                g.DrawImage(poster, cx, cy, cardW, cardH - 50);
            } else {
                SolidBrush phBg(Color(255, 15, 13, 22));
                g.FillRectangle(&phBg, cx, cy, cardW, cardH - 50);
                g.DrawString(L"[Film]", -1, &navFont, PointF((REAL)cx + 60, (REAL)cy + 90), &redBrush);
            }

            // Rating Badge
            if (!g_App.filteredMovies[i].rating.empty()) {
                SolidBrush badgeBg(Color(200, 0, 0, 0));
                g.FillRectangle(&badgeBg, cx + cardW - 38, cy + 8, 30, 18);
                g.DrawString(g_App.filteredMovies[i].rating.c_str(), -1, &cardSubFont, PointF((REAL)cx + cardW - 34, (REAL)cy + 10), &whiteBrush);
            }

            // Info
            g.DrawString(g_App.filteredMovies[i].title.c_str(), -1, &cardFont, PointF((REAL)cx + 8, (REAL)cy + cardH - 44), &whiteBrush);
            g.DrawString(g_App.filteredMovies[i].year.c_str(), -1, &cardSubFont, PointF((REAL)cx + 8, (REAL)cy + cardH - 24), &grayBrush);
        }
    }

    // 4. Detail Hub Overlay
    if (g_App.overlay == OverlayState::DetailHub) {
        SolidBrush hubBg(Color(245, 8, 6, 14));
        g.FillRectangle(&hubBg, g_App.sidebarWidth, 0, width - g_App.sidebarWidth, height);

        // Banner
        Gdiplus::Bitmap* banner = g_App.getImage(g_App.selectedMovie.banner);
        if (!banner) banner = g_App.getImage(g_App.selectedMovie.poster);
        if (banner) {
            ImageAttributes imgAttr;
            ColorMatrix matrix = {
                1.0f, 0.0f, 0.0f, 0.0f, 0.0f,
                0.0f, 1.0f, 0.0f, 0.0f, 0.0f,
                0.0f, 0.0f, 1.0f, 0.0f, 0.0f,
                0.0f, 0.0f, 0.0f, 0.35f, 0.0f,
                0.0f, 0.0f, 0.0f, 0.0f, 1.0f
            };
            imgAttr.SetColorMatrix(&matrix);
            g.DrawImage(banner, Rect(width - 550, 0, 550, height), 0, 0, banner->GetWidth(), banner->GetHeight(), UnitPixel, &imgAttr);
        }

        int dx = g_App.sidebarWidth + 60;
        int dy = 50;

        // Close button
        SolidBrush closeBtnBg(Color(255, 30, 26, 40));
        g.FillRectangle(&closeBtnBg, width - 120, 24, 90, 32);
        g.DrawString(L"X Close", -1, &subFont, PointF((REAL)width - 100, 32), &whiteBrush);

        Font hTitle(&fontFamily, 36, FontStyleBold, UnitPixel);
        Font hSub(&fontFamily, 14, FontStyleBold, UnitPixel);
        Font hDesc(&fontFamily, 14, FontStyleRegular, UnitPixel);

        g.DrawString(g_App.selectedMovie.title.c_str(), -1, &hTitle, PointF((REAL)dx, (REAL)dy), &whiteBrush);

        std::wstring metaInfo = g_App.selectedMovie.year + L"  *  " + g_App.selectedMovie.rating;
        if (!g_App.selectedMovie.genre.empty()) metaInfo += L"  *  " + g_App.selectedMovie.genre;
        g.DrawString(metaInfo.c_str(), -1, &hSub, PointF((REAL)dx, (REAL)dy + 50), &grayBrush);

        if (!g_App.selectedMovie.tagline.empty()) {
            g.DrawString(g_App.selectedMovie.tagline.c_str(), -1, &hSub, PointF((REAL)dx, (REAL)dy + 78), &redBrush);
        }

        if (!g_App.selectedMovie.description.empty()) {
            RectF descRect((REAL)dx, (REAL)dy + 115, 550.0f, 120.0f);
            g.DrawString(g_App.selectedMovie.description.c_str(), -1, &hDesc, descRect, NULL, &grayBrush);
        }

        // Action Buttons
        int by = dy + 250;
        g.FillRectangle(&redBrush, dx, by, 160, 42);
        g.DrawString(L"> Play Movie", -1, &navFont, PointF((REAL)dx + 30, (REAL)by + 11), &whiteBrush);

        SolidBrush editBtnBg(Color(255, 35, 30, 50));
        g.FillRectangle(&editBtnBg, dx + 180, by, 150, 42);
        g.DrawString(L"Edit Metadata", -1, &navFont, PointF((REAL)dx + 205, (REAL)by + 11), &whiteBrush);

        // Cast Row
        if (!g_App.selectedMovie.cast.empty()) {
            int cy = by + 70;
            g.DrawString(L"Cast & Characters", -1, &navFont, PointF((REAL)dx, (REAL)cy), &whiteBrush);
            for (size_t ci = 0; ci < min((size_t)5, g_App.selectedMovie.cast.size()); ci++) {
                int cx = dx + (int)ci * 110;
                int cay = cy + 30;
                SolidBrush avBg(Color(255, 25, 22, 35));
                g.FillEllipse(&avBg, cx, cay, 64, 64);
                g.DrawEllipse(&borderPen, cx, cay, 64, 64);

                Gdiplus::Bitmap* castPic = g_App.getImage(g_App.selectedMovie.cast[ci].image);
                if (castPic) {
                    g.DrawImage(castPic, cx, cay, 64, 64);
                } else {
                    g.DrawString(L"Actor", -1, &cardSubFont, PointF((REAL)cx + 16, (REAL)cay + 24), &redBrush);
                }

                g.DrawString(g_App.selectedMovie.cast[ci].name.c_str(), -1, &cardSubFont, PointF((REAL)cx, (REAL)cay + 70), &whiteBrush);
                g.DrawString(g_App.selectedMovie.cast[ci].role.c_str(), -1, &cardSubFont, PointF((REAL)cx, (REAL)cay + 86), &grayBrush);
            }
        }
    }

    // 5. Metadata Editor Drawer Overlay
    if (g_App.overlay == OverlayState::EditorDrawer) {
        int drawerW = 460;
        int dx = width - drawerW;
        SolidBrush drawerBg(Color(255, 15, 12, 28));
        g.FillRectangle(&drawerBg, dx, 0, drawerW, height);
        g.DrawLine(&borderPen, dx, 0, dx, height);

        Font dTitle(&fontFamily, 20, FontStyleBold, UnitPixel);
        g.DrawString(L"Edit Movie Metadata", -1, &dTitle, PointF((REAL)dx + 30, 24), &redBrush);

        // Input Fields (Title, Year, Rating, Genre)
        Font lblFont(&fontFamily, 12, FontStyleBold, UnitPixel);
        SolidBrush inputBg(Color(255, 25, 20, 36));

        auto drawField = [&](int y, const wchar_t* label, const std::wstring& val) {
            g.DrawString(label, -1, &lblFont, PointF((REAL)dx + 30, (REAL)y), &grayBrush);
            g.FillRectangle(&inputBg, dx + 30, y + 20, drawerW - 60, 32);
            g.DrawRectangle(&borderPen, dx + 30, y + 20, drawerW - 60, 32);
            g.DrawString(val.c_str(), -1, &subFont, PointF((REAL)dx + 40, (REAL)y + 26), &whiteBrush);
        };

        drawField(70, L"Movie Title (Required)", g_App.editingMovie.title);
        drawField(135, L"Year (4 Digits Required)", g_App.editingMovie.year);
        drawField(200, L"Rating", g_App.editingMovie.rating);
        drawField(265, L"Genre", g_App.editingMovie.genre);
        drawField(330, L"Tagline", g_App.editingMovie.tagline);

        // Pick Poster Button
        g.FillRectangle(&inputBg, dx + 30, 410, 180, 32);
        g.DrawString(L"Pick Poster Art...", -1, &subFont, PointF((REAL)dx + 45, 418), &whiteBrush);

        // Pick Banner Button
        g.FillRectangle(&inputBg, dx + 230, 410, 180, 32);
        g.DrawString(L"Pick Banner...", -1, &subFont, PointF((REAL)dx + 250, 418), &whiteBrush);

        // Save & Cancel Buttons
        g.FillRectangle(&redBrush, dx + 30, height - 70, 180, 38);
        g.DrawString(L"Save Changes", -1, &navFont, PointF((REAL)dx + 70, (REAL)height - 60), &whiteBrush);

        SolidBrush cancelBtn(Color(255, 35, 30, 45));
        g.FillRectangle(&cancelBtn, dx + 230, height - 70, 180, 38);
        g.DrawString(L"Cancel", -1, &navFont, PointF((REAL)dx + 295, (REAL)height - 60), &whiteBrush);
    }

    // 6. Player Exit Button Overlay
    if (g_App.overlay == OverlayState::Player) {
        SolidBrush closeBtnBg(Color(200, 255, 42, 59));
        g.FillRectangle(&closeBtnBg, width - 140, 20, 110, 36);
        g.DrawString(L"< Back", -1, &navFont, PointF((REAL)width - 115, 28), &whiteBrush);
    }

    BitBlt(hdc, 0, 0, width, height, memDC, 0, 0, SRCCOPY);
    SelectObject(memDC, oldBitmap);
    DeleteObject(memBitmap);
    DeleteDC(memDC);

    EndPaint(hwnd, &ps);
}

// Mouse and Keyboard Handling
LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_CREATE: {
            g_App.hwndMain = hwnd;
            g_App.scanLibrary();
            return 0;
        }

        case WM_LBUTTONDOWN: {
            int mx = GET_X_LPARAM(lParam);
            int my = GET_Y_LPARAM(lParam);

            RECT rc;
            GetClientRect(hwnd, &rc);
            int width = rc.right;
            int height = rc.bottom;

            // Player overlay back button
            if (g_App.overlay == OverlayState::Player) {
                if (mx >= width - 140 && mx <= width - 30 && my >= 20 && my <= 56) {
                    g_App.stopPlayback();
                }
                return 0;
            }

            // Detail Hub Clicks
            if (g_App.overlay == OverlayState::DetailHub) {
                // Close
                if (mx >= width - 120 && mx <= width - 30 && my >= 24 && my <= 56) {
                    g_App.overlay = OverlayState::None;
                    InvalidateRect(hwnd, NULL, FALSE);
                    return 0;
                }
                // Play
                int dx = g_App.sidebarWidth + 60;
                int by = 300;
                if (mx >= dx && mx <= dx + 160 && my >= by && my <= by + 42) {
                    g_App.startPlayback(g_App.selectedMovie);
                    return 0;
                }
                // Edit
                if (mx >= dx + 180 && mx <= dx + 330 && my >= by && my <= by + 42) {
                    g_App.editingMovie = g_App.selectedMovie;
                    g_App.overlay = OverlayState::EditorDrawer;
                    InvalidateRect(hwnd, NULL, FALSE);
                    return 0;
                }
                return 0;
            }

            // Editor Drawer Clicks
            if (g_App.overlay == OverlayState::EditorDrawer) {
                int drawerW = 460;
                int dx = width - drawerW;
                // Cancel
                if (mx >= dx + 230 && mx <= dx + 410 && my >= height - 70 && my <= height - 32) {
                    g_App.overlay = OverlayState::DetailHub;
                    InvalidateRect(hwnd, NULL, FALSE);
                    return 0;
                }
                // Save
                if (mx >= dx + 30 && mx <= dx + 210 && my >= height - 70 && my <= height - 32) {
                    if (!g_App.editingMovie.title.empty() && !g_App.editingMovie.year.empty()) {
                        g_App.saveMovieGmd(g_App.editingMovie);
                        g_App.scanLibrary();
                        g_App.selectedMovie = g_App.editingMovie;
                        g_App.overlay = OverlayState::DetailHub;
                        InvalidateRect(hwnd, NULL, FALSE);
                    }
                    return 0;
                }
                // Pick Poster Art
                if (mx >= dx + 30 && mx <= dx + 210 && my >= 410 && my <= 442) {
                    std::wstring file = g_App.openFileDialog(L"Image Files (*.jpg;*.png;*.webp)\0*.jpg;*.png;*.webp\0All Files (*.*)\0*.*\0");
                    if (!file.empty()) {
                        g_App.editingMovie.poster = g_App.copyArtToFolder(file, g_App.posterDir);
                        InvalidateRect(hwnd, NULL, FALSE);
                    }
                    return 0;
                }
                // Pick Banner Art
                if (mx >= dx + 230 && mx <= dx + 410 && my >= 410 && my <= 442) {
                    std::wstring file = g_App.openFileDialog(L"Image Files (*.jpg;*.png;*.webp)\0*.jpg;*.png;*.webp\0All Files (*.*)\0*.*\0");
                    if (!file.empty()) {
                        g_App.editingMovie.banner = g_App.copyArtToFolder(file, g_App.bgDir);
                        InvalidateRect(hwnd, NULL, FALSE);
                    }
                    return 0;
                }
                return 0;
            }

            // Sidebar Nav Clicks
            if (mx < g_App.sidebarWidth) {
                for (int i = 0; i < 4; i++) {
                    int navY = 110 + i * 46;
                    if (my >= navY && my <= navY + 42) {
                        g_App.currentView = (AppView)i;
                        g_App.overlay = OverlayState::None;
                        InvalidateRect(hwnd, NULL, FALSE);
                        return 0;
                    }
                }
                return 0;
            }

            // Top Buttons
            int mainY = 32 - g_App.scrollOffsetY;
            if (my >= mainY + 4 && my <= mainY + 36) {
                // Rebuild GMD
                if (mx >= width - 420 && mx <= width - 300) {
                    g_App.rebuildMissing();
                    return 0;
                }
                // Refresh
                if (mx >= width - 290 && mx <= width - 190) {
                    g_App.scanLibrary();
                    return 0;
                }
                // Add Movie
                if (mx >= width - 180 && mx <= width - 50) {
                    std::wstring file = g_App.openFileDialog(L"Video Files (*.mp4;*.mkv;*.webm)\0*.mp4;*.mkv;*.webm\0All Files (*.*)\0*.*\0");
                    if (!file.empty()) {
                        try {
                            fs::path src(file);
                            fs::path dest = g_App.videosDir / src.filename();
                            fs::copy_file(src, dest, fs::copy_options::overwrite_existing);
                            g_App.scanLibrary();
                        } catch (...) {}
                    }
                    return 0;
                }
            }

            // Movie Cards Click
            int mainX = g_App.sidebarWidth + 36;
            int startY = mainY + 60;
            int cardW = 170;
            int cardH = 260;
            int gap = 24;
            int cols = max(1, (width - mainX - 40) / (cardW + gap));

            for (size_t i = 0; i < g_App.filteredMovies.size(); i++) {
                int col = (int)i % cols;
                int row = (int)i / cols;
                int cx = mainX + col * (cardW + gap);
                int cy = startY + row * (cardH + gap);

                if (mx >= cx && mx <= cx + cardW && my >= cy && my <= cy + cardH) {
                    g_App.selectedMovie = g_App.filteredMovies[i];
                    g_App.overlay = OverlayState::DetailHub;
                    InvalidateRect(hwnd, NULL, FALSE);
                    return 0;
                }
            }
            return 0;
        }

        case WM_KEYDOWN: {
            if (wParam == VK_ESCAPE) {
                if (g_App.overlay == OverlayState::Player) {
                    g_App.stopPlayback();
                } else if (g_App.overlay != OverlayState::None) {
                    g_App.overlay = OverlayState::None;
                    InvalidateRect(hwnd, NULL, FALSE);
                }
            } else if (wParam == VK_SPACE && g_App.pPlayer) {
                if (g_App.isPlaying) {
                    g_App.pPlayer->Pause();
                    g_App.isPlaying = false;
                } else {
                    g_App.pPlayer->Play();
                    g_App.isPlaying = true;
                }
            }
            return 0;
        }

        case WM_MOUSEWHEEL: {
            short delta = GET_WHEEL_DELTA_WPARAM(wParam);
            g_App.scrollOffsetY = max(0, g_App.scrollOffsetY - (delta / 2));
            InvalidateRect(hwnd, NULL, FALSE);
            return 0;
        }

        case WM_SIZE: {
            if (g_App.hwndVideoHost && g_App.overlay == OverlayState::Player) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                MoveWindow(g_App.hwndVideoHost, g_App.sidebarWidth, 0, rc.right - g_App.sidebarWidth, rc.bottom, TRUE);
            }
            InvalidateRect(hwnd, NULL, FALSE);
            return 0;
        }

        case WM_PAINT:
            OnPaint(hwnd);
            return 0;

        case WM_DESTROY:
            if (g_App.pPlayer) {
                g_App.pPlayer->Shutdown();
                g_App.pPlayer->Release();
                g_App.pPlayer = NULL;
            }
            MFShutdown();
            CoUninitialize();
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    // 1. Initialize GDI+
    GdiplusStartupInput gdiplusStartupInput;
    GdiplusStartup(&g_App.gdiplusToken, &gdiplusStartupInput, NULL);

    // 2. Register Window Class
    WNDCLASSEXW wc = {0};
    wc.cbSize = sizeof(WNDCLASSEXW);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
    wc.lpszClassName = L"GorillaFlixNativeWindowClass";

    RegisterClassExW(&wc);

    // 3. Create Main Window
    HWND hwnd = CreateWindowExW(
        0,
        wc.lpszClassName,
        L"GorillaFlix",
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
        CW_USEDEFAULT, CW_USEDEFAULT, 1280, 800,
        NULL, NULL, hInstance, NULL
    );

    if (!hwnd) return 1;

    ShowWindow(hwnd, nCmdShow);
    UpdateWindow(hwnd);

    // 4. Message Loop
    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    GdiplusShutdown(g_App.gdiplusToken);
    return (int)msg.wParam;
}
