#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <string.h>

@interface SynlexaNativeAppDelegate
    : NSObject <NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, NSWindowDelegate>
@property(nonatomic, strong) NSWindow *mainWindow;
@property(nonatomic, strong) WKWebView *mainWebView;
@property(nonatomic, strong) NSMutableArray<NSWindow *> *popupWindows;
@property(nonatomic, copy) NSURL *initialURL;
@end

@implementation SynlexaNativeAppDelegate

- (instancetype)initWithURL:(NSURL *)url {
  self = [super init];
  if (self) {
    _initialURL = [url copy];
    _popupWindows = [NSMutableArray array];
  }
  return self;
}

- (void)buildMainMenu {
  NSMenu *menubar = [[NSMenu alloc] init];
  NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
  [menubar addItem:appMenuItem];

  NSMenu *appMenu = [[NSMenu alloc] init];
  [appMenu addItemWithTitle:@"About Synlexa Studio"
                     action:@selector(orderFrontStandardAboutPanel:)
              keyEquivalent:@""];
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"Hide Synlexa Studio"
                     action:@selector(hide:)
              keyEquivalent:@"h"];
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"Quit Synlexa Studio"
                     action:@selector(terminate:)
              keyEquivalent:@"q"];
  [appMenuItem setSubmenu:appMenu];

  NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
  [menubar addItem:editMenuItem];
  NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
  [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
  [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
  [editMenu addItem:[NSMenuItem separatorItem]];
  [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  [editMenuItem setSubmenu:editMenu];

  NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
  [menubar addItem:windowMenuItem];
  NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
  [windowMenu addItemWithTitle:@"Close Window" action:@selector(performClose:) keyEquivalent:@"w"];
  [windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
  [windowMenuItem setSubmenu:windowMenu];

  [NSApp setMainMenu:menubar];
}

- (NSWindow *)windowForWebView:(WKWebView *)webView {
  for (NSWindow *win in self.popupWindows) {
    if (win.contentView == webView) {
      return win;
    }
  }
  if (self.mainWindow.contentView == webView) {
    return self.mainWindow;
  }
  return webView.window;
}

- (void)closePopupForWebView:(WKWebView *)webView {
  NSWindow *win = [self windowForWebView:webView];
  if (win && win != self.mainWindow) {
    [self.popupWindows removeObject:win];
    [win close];
  }
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  [self.mainWindow center];
  [self.mainWindow makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  (void)sender;
  return YES;
}

- (void)windowWillClose:(NSNotification *)notification {
  NSWindow *closing = notification.object;
  if (closing == self.mainWindow) {
    for (NSWindow *popup in [self.popupWindows copy]) {
      [popup close];
    }
    [self.popupWindows removeAllObjects];
    [NSApp terminate:nil];
    return;
  }
  [self.popupWindows removeObject:closing];
}

- (nullable WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)navigationAction
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
  (void)webView;
  NSURL *targetUrl = navigationAction.request.URL;
  NSString *urlStr = targetUrl.absoluteString ?: @"";

  // External link clicks (literature DOIs/PMIDs, external docs) open in default browser;
  // OAuth popups (about:blank -> synlexa.com/auth/studio-connect) stay inside a small app popup window.
  BOOL isLoopback = [targetUrl.host isEqualToString:@"127.0.0.1"] ||
                    [targetUrl.host isEqualToString:@"localhost"];
  BOOL isAuthConnect = [urlStr containsString:@"studio-connect"] || [urlStr containsString:@"about:blank"];
  if (navigationAction.navigationType == WKNavigationTypeLinkActivated &&
      targetUrl != nil && !isLoopback && !isAuthConnect &&
      ([targetUrl.scheme isEqualToString:@"https"] || [targetUrl.scheme isEqualToString:@"http"])) {
    [[NSWorkspace sharedWorkspace] openURL:targetUrl];
    return nil;
  }

  CGFloat width = windowFeatures.width ? [windowFeatures.width doubleValue] : 480.0;
  CGFloat height = windowFeatures.height ? [windowFeatures.height doubleValue] : 720.0;
  if (width < 360.0) width = 480.0;
  if (height < 480.0) height = 720.0;

  NSRect mainFrame = self.mainWindow.frame;
  CGFloat originX = mainFrame.origin.x + (mainFrame.size.width - width) / 2.0;
  CGFloat originY = mainFrame.origin.y + (mainFrame.size.height - height) / 2.0;

  NSWindow *popup = [[NSWindow alloc]
      initWithContentRect:NSMakeRect(originX, originY, width, height)
                styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                           NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
                  backing:NSBackingStoreBuffered
                    defer:NO];
  popup.title = @"Synlexa Studio — Sign In";
  popup.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  popup.releasedWhenClosed = NO;
  popup.delegate = self;

  WKWebView *popupView = [[WKWebView alloc] initWithFrame:popup.contentView.bounds
                                            configuration:configuration];
  popupView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  popupView.UIDelegate = self;
  popupView.navigationDelegate = self;
  popup.contentView = popupView;

  [self.popupWindows addObject:popup];
  [popup makeKeyAndOrderFront:nil];
  return popupView;
}

- (void)webViewDidClose:(WKWebView *)webView {
  [self closePopupForWebView:webView];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)navigation;
  if (webView == self.mainWebView) {
    return;
  }
  NSString *urlStr = webView.URL.absoluteString ?: @"";
  if ([urlStr containsString:@"studio_auth=callback"]) {
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(300 * NSEC_PER_MSEC)),
                   dispatch_get_main_queue(), ^{
                     [weakSelf closePopupForWebView:webView];
                   });
  }
}

- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> *_Nullable URLs))completionHandler {
  (void)webView;
  (void)frame;
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
  panel.canChooseFiles = YES;
  panel.canChooseDirectories = parameters.allowsDirectories;
  [panel beginSheetModalForWindow:self.mainWindow
                completionHandler:^(NSModalResponse result) {
                  if (result == NSModalResponseOK) {
                    completionHandler(panel.URLs);
                  } else {
                    completionHandler(nil);
                  }
                }];
}

- (void)webView:(WKWebView *)webView
    runJavaScriptAlertPanelWithMessage:(NSString *)message
                      initiatedByFrame:(WKFrameInfo *)frame
                     completionHandler:(void (^)(void))completionHandler {
  (void)frame;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Synlexa Studio";
  alert.informativeText = message ?: @"";
  NSWindow *host = [self windowForWebView:webView] ?: self.mainWindow;
  [alert beginSheetModalForWindow:host
                completionHandler:^(NSModalResponse r) {
                  (void)r;
                  completionHandler();
                }];
}

- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
                        initiatedByFrame:(WKFrameInfo *)frame
                       completionHandler:(void (^)(BOOL result))completionHandler {
  (void)frame;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Synlexa Studio";
  alert.informativeText = message ?: @"";
  [alert addButtonWithTitle:@"OK"];
  [alert addButtonWithTitle:@"Cancel"];
  NSWindow *host = [self windowForWebView:webView] ?: self.mainWindow;
  [alert beginSheetModalForWindow:host
                completionHandler:^(NSModalResponse r) {
                  completionHandler(r == NSAlertFirstButtonReturn);
                }];
}

@end

void synlexa_run_macos_native_window(const char *url_cstr, const char *icon_path_cstr) {
  @autoreleasepool {
    if (!url_cstr) return;
    NSString *urlString = [NSString stringWithUTF8String:url_cstr];
    NSURL *url = [NSURL URLWithString:urlString];
    if (!url) return;

    NSApplication *app = [NSApplication sharedApplication];
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];

    if (icon_path_cstr && strlen(icon_path_cstr) > 0) {
      NSString *iconPath = [NSString stringWithUTF8String:icon_path_cstr];
      NSImage *iconImage = [[NSImage alloc] initWithContentsOfFile:iconPath];
      if (iconImage) {
        [app setApplicationIconImage:iconImage];
      }
    }

    SynlexaNativeAppDelegate *delegate = [[SynlexaNativeAppDelegate alloc] initWithURL:url];
    [app setDelegate:delegate];
    [delegate buildMainMenu];

    NSRect visible = [NSScreen mainScreen] ? [NSScreen mainScreen].visibleFrame
                                           : NSMakeRect(0, 0, 1440, 900);
    CGFloat w = MIN(1440.0, visible.size.width * 0.92);
    CGFloat h = MIN(900.0, visible.size.height * 0.92);
    NSRect frame = NSMakeRect(visible.origin.x + (visible.size.width - w) / 2.0,
                              visible.origin.y + (visible.size.height - h) / 2.0, w, h);

    NSWindow *window = [[NSWindow alloc]
        initWithContentRect:frame
                  styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                             NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
                    backing:NSBackingStoreBuffered
                      defer:NO];
    window.title = @"Synlexa Studio";
    window.minSize = NSMakeSize(960.0, 640.0);
    window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
    window.releasedWhenClosed = NO;
    window.delegate = delegate;

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    config.preferences.javaScriptCanOpenWindowsAutomatically = YES;

    WKWebView *webView = [[WKWebView alloc] initWithFrame:window.contentView.bounds
                                            configuration:config];
    webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    webView.UIDelegate = delegate;
    webView.navigationDelegate = delegate;
    [webView setValue:@NO forKey:@"drawsBackground"];
    window.backgroundColor = [NSColor colorWithRed:0.043 green:0.055 blue:0.078 alpha:1.0];
    window.contentView = webView;

    delegate.mainWindow = window;
    delegate.mainWebView = webView;

    [webView loadRequest:[NSURLRequest requestWithURL:url]];

    // Complete launch lifecycle immediately so LaunchServices stops bouncing the Dock icon.
    [app finishLaunching];
    [window makeKeyAndOrderFront:nil];
    [app activateIgnoringOtherApps:YES];
    [app run];
  }
}
