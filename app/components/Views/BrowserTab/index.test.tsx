import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AppConstants from '../../../core/AppConstants';
import renderWithProvider from '../../../util/test/renderWithProvider';
import { backgroundState } from '../../../util/test/initial-root-state';
import { MOCK_ACCOUNTS_CONTROLLER_STATE } from '../../../util/test/accountsControllerTestUtils';
import BrowserTab from './BrowserTab';
import Routes from '../../../constants/navigation/Routes';
import { getPhishingTestResultAsync } from '../../../util/phishingDetection';

const mockInjectJavaScript = jest.fn();
const mockStopLoading = jest.fn();

interface MockBridge {
  url: string;
  onMessage: jest.Mock;
  onDisconnect: jest.Mock;
}
const mockBridges: MockBridge[] = [];

jest.mock('../../../core/BackgroundBridge/BackgroundBridge', () =>
  jest.fn().mockImplementation(({ url }: { url: string }) => {
    const bridge = {
      url,
      onMessage: jest.fn(),
      onDisconnect: jest.fn(),
      sendNotificationEip1193: jest.fn(),
    };
    mockBridges.push(bridge);
    return bridge;
  }),
);

jest.mock('@metamask/react-native-webview', () => {
  const { View } = jest.requireActual('react-native');
  const ActualReact = jest.requireActual('react');

  const MockWebView = ActualReact.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      ActualReact.useImperativeHandle(ref, () => ({
        injectJavaScript: mockInjectJavaScript,
        stopLoading: mockStopLoading,
      }));
      return <View {...props} />;
    },
  );
  MockWebView.displayName = 'WebView';

  return {
    __esModule: true,
    WebView: MockWebView,
    default: MockWebView,
  };
});

const mockNavigation = {
  goBack: jest.fn(),
  goForward: jest.fn(),
  canGoBack: true,
  canGoForward: true,
  addListener: jest.fn(),
  navigate: jest.fn(),
};

const mockRoute = {
  params: { url: '' },
};

jest.mock('@react-navigation/native', () => {
  const actualNav = jest.requireActual('@react-navigation/native');
  return {
    ...actualNav,
    useNavigation: () => mockNavigation,
    useIsFocused: () => true,
    useRoute: () => mockRoute,
  };
});

jest.mock('react-native-device-info', () => ({
  getVersion: jest.fn(() => '7.0.0'),
}));

const mockInitialState = {
  browser: {
    activeTab: 1,
    history: [],
    whitelist: [],
    tabs: [],
    favicons: [],
    visitedDappsByHostname: {},
    isFullscreen: false,
  },
  engine: {
    backgroundState: {
      ...backgroundState,
      AccountsController: MOCK_ACCOUNTS_CONTROLLER_STATE,
    },
  },
  settings: {
    searchEngine: 'Google',
  },
};

jest.mock('../../../core/Engine', () => ({
  context: {
    AccountsController: {
      listMultichainAccounts: () => [],
    },
    CurrencyRateController: {
      updateExchangeRate: jest.fn(),
    },
    PermissionController: {
      state: { subjects: {} },
    },
  },
}));

jest.mock('../../../core/EntryScriptWeb3', () => ({
  init: jest.fn(),
  get: () => '',
}));

jest.mock('../../../util/phishingDetection', () => ({
  getPhishingTestResultAsync: jest.fn(() =>
    Promise.resolve({ result: false, name: '' }),
  ),
}));

jest.mock('../../hooks/useNetworkEnablement/useNetworkEnablement', () => ({
  useNetworkEnablement: () => ({
    namespace: 'eip155',
    enabledNetworksByNamespace: {},
    enabledNetworksForCurrentNamespace: {},
    enabledNetworksForAllNamespaces: {},
    networkEnablementController: {},
    enableNetwork: jest.fn(),
    disableNetwork: jest.fn(),
    enableAllPopularNetworks: jest.fn(),
    popularEvmNetworks: [],
    popularMultichainNetworks: [],
    popularNetworks: [],
    isNetworkEnabled: jest.fn(),
    hasOneEnabledNetwork: false,
    tryEnableEvmNetwork: jest.fn(),
  }),
}));

const mockProps = {
  id: 1,
  activeTab: 1,
  defaultProtocol: 'https://',
  searchEngine: 'Google',
  newTab: jest.fn(),
  addBookmark: jest.fn(),
  updateTabInfo: jest.fn(),
  showTabs: jest.fn(),
  isInTabsView: false,
  initialUrl: 'https://metamask.io',
  homePageUrl: AppConstants.HOMEPAGE_URL,
};

describe('BrowserTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInjectJavaScript.mockClear();
    mockBridges.length = 0;
  });

  it('render Browser', async () => {
    renderWithProvider(<BrowserTab {...mockProps} />, {
      state: mockInitialState,
    });
    await waitFor(() =>
      expect(screen.getByTestId('browser-webview')).toBeVisible(),
    );

    expect(screen.toJSON()).toMatchSnapshot();
  });

  describe('Back Button', () => {
    it('renders back button when URL bar is not focused', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const backButton = screen.getByTestId('browser-tab-close-button');
      expect(backButton).toBeTruthy();
    });

    it('goes back when close button is pressed and opened from benefit', async () => {
      renderWithProvider(<BrowserTab {...mockProps} fromBenefit />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      fireEvent.press(screen.getByTestId('browser-tab-close-button'));

      expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
      expect(mockNavigation.navigate).not.toHaveBeenCalledWith(
        Routes.TRENDING_VIEW,
        expect.anything(),
      );
    });
  });

  describe('WebView originWhitelist', () => {
    it('sets originWhitelist to wildcard for all URLs', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      expect(webView.props.originWhitelist).toEqual(['*']);
    });
  });

  describe('WebView onShouldStartLoadWithRequest', () => {
    it('blocks ftp URL protocol', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      const onShouldStartLoadWithRequest =
        webView.props.onShouldStartLoadWithRequest;

      expect(
        onShouldStartLoadWithRequest({
          url: 'ftp://example.com',
        }),
      ).toBe(false);
    });

    it('Stops webview from loading resource and prompts user', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      const onShouldStartLoadWithRequest =
        webView.props.onShouldStartLoadWithRequest;

      expect(
        onShouldStartLoadWithRequest({
          url: 'tel:+1234567890',
        }),
      ).toBe(false);
    });

    it('allow https resorce to load on webview', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      const onShouldStartLoadWithRequest =
        webView.props.onShouldStartLoadWithRequest;

      expect(
        onShouldStartLoadWithRequest({
          url: 'https://google.com',
        }),
      ).toBe(true);
    });

    it('shows alert for non-whitelisted protocol javascript:', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      const onShouldStartLoadWithRequest =
        webView.props.onShouldStartLoadWithRequest;

      expect(
        onShouldStartLoadWithRequest({
          // eslint-disable-next-line no-script-url
          url: 'javascript://example.com',
        }),
      ).toBe(false);
    });
  });

  describe('WebView onOpenWindow', () => {
    it('passes onOpenWindow handler to WebView', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');

      expect(typeof webView.props.onOpenWindow).toBe('function');
    });

    it('calls injectJavaScript with sanitized target URL when onOpenWindow fires', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      const { onOpenWindow } = webView.props;

      onOpenWindow({
        nativeEvent: { targetUrl: 'https://stake.lido.fi' },
      });

      expect(mockInjectJavaScript).toHaveBeenCalledTimes(1);
      expect(mockInjectJavaScript).toHaveBeenCalledWith(
        "window.location.href = 'https://stake.lido.fi'; true;",
      );
    });

    it('sanitizes single quotes in the target URL before injecting', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      const { onOpenWindow } = webView.props;

      onOpenWindow({
        nativeEvent: { targetUrl: "https://example.com/path?q='test'" },
      });

      expect(mockInjectJavaScript).toHaveBeenCalledTimes(1);
      expect(mockInjectJavaScript).toHaveBeenCalledWith(
        "window.location.href = 'https://example.com/path?q=%27test%27'; true;",
      );
    });

    it('does not call injectJavaScript when targetUrl is empty', async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });

      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );

      const webView = screen.getByTestId('browser-webview');
      const { onOpenWindow } = webView.props;

      onOpenWindow({
        nativeEvent: { targetUrl: '' },
      });

      expect(mockInjectJavaScript).not.toHaveBeenCalled();
    });
  });
  describe('provider bridge origin', () => {
    const TRUSTED_URL = 'https://trusted.example/';
    const PHISHING_URL = 'https://phishing.example/';

    const renderAndGetWebView = async () => {
      renderWithProvider(<BrowserTab {...mockProps} />, {
        state: mockInitialState,
      });
      await waitFor(() =>
        expect(screen.getByTestId('browser-webview')).toBeVisible(),
      );
      return screen.getByTestId('browser-webview');
    };

    const loadStart = async (
      webView: ReturnType<typeof screen.getByTestId>,
      url: string,
    ) => {
      await act(async () => {
        await webView.props.onLoadStart({ nativeEvent: { url } });
      });
    };

    const providerMessage = (origin: string) =>
      JSON.stringify({
        name: 'metamask-provider',
        origin,
        data: { method: 'personal_sign' },
      });

    it('forwards provider messages with the origin reported by the WebView', async () => {
      const webView = await renderAndGetWebView();
      await loadStart(webView, TRUSTED_URL);

      webView.props.onMessage({
        nativeEvent: {
          url: TRUSTED_URL,
          data: providerMessage(TRUSTED_URL),
        },
      });

      expect(mockBridges).toHaveLength(1);
      expect(mockBridges[0].onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'metamask-provider',
          origin: 'https://trusted.example',
        }),
      );
    });

    it('drops provider messages whose declared origin does not match the WebView origin', async () => {
      const webView = await renderAndGetWebView();
      await loadStart(webView, TRUSTED_URL);

      webView.props.onMessage({
        nativeEvent: {
          url: PHISHING_URL,
          data: providerMessage(TRUSTED_URL),
        },
      });

      expect(mockBridges[0].onMessage).not.toHaveBeenCalled();
    });

    it('overrides a missing declared origin with the WebView origin', async () => {
      const webView = await renderAndGetWebView();
      await loadStart(webView, TRUSTED_URL);

      webView.props.onMessage({
        nativeEvent: {
          url: PHISHING_URL,
          data: JSON.stringify({ name: 'metamask-provider', data: {} }),
        },
      });

      expect(mockBridges[0].onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'https://phishing.example' }),
      );
    });

    it('disconnects the previous bridge before the phishing check resolves', async () => {
      const webView = await renderAndGetWebView();
      await loadStart(webView, TRUSTED_URL);
      const trustedBridge = mockBridges[0];

      let resolvePhishingCheck: (value: unknown) => void = () => undefined;
      (getPhishingTestResultAsync as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePhishingCheck = resolve;
          }),
      );

      let pendingLoad: Promise<unknown> = Promise.resolve();
      act(() => {
        pendingLoad = webView.props.onLoadStart({
          nativeEvent: { url: PHISHING_URL },
        });
      });

      expect(trustedBridge.onDisconnect).toHaveBeenCalledTimes(1);

      webView.props.onMessage({
        nativeEvent: {
          url: PHISHING_URL,
          data: providerMessage(TRUSTED_URL),
        },
      });
      expect(trustedBridge.onMessage).not.toHaveBeenCalled();

      await act(async () => {
        resolvePhishingCheck({ result: false, name: '' });
        await pendingLoad;
      });
      expect(mockBridges).toHaveLength(2);
      expect(mockBridges[1].url).toBe('https://phishing.example');
    });

    it('stops loading and does not create a bridge for blocked pages', async () => {
      const webView = await renderAndGetWebView();
      await loadStart(webView, TRUSTED_URL);
      const trustedBridge = mockBridges[0];

      (getPhishingTestResultAsync as jest.Mock).mockResolvedValueOnce({
        result: true,
        name: 'phishing',
      });
      await loadStart(webView, PHISHING_URL);

      expect(mockStopLoading).toHaveBeenCalled();
      expect(trustedBridge.onDisconnect).toHaveBeenCalledTimes(1);
      expect(mockBridges).toHaveLength(1);

      webView.props.onMessage({
        nativeEvent: {
          url: PHISHING_URL,
          data: providerMessage(TRUSTED_URL),
        },
      });
      expect(trustedBridge.onMessage).not.toHaveBeenCalled();
    });

    it('ignores a stale phishing check from a superseded navigation', async () => {
      const webView = await renderAndGetWebView();

      let resolveStaleCheck: (value: unknown) => void = () => undefined;
      (getPhishingTestResultAsync as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleCheck = resolve;
          }),
      );
      let staleLoad: Promise<unknown> = Promise.resolve();
      act(() => {
        staleLoad = webView.props.onLoadStart({
          nativeEvent: { url: PHISHING_URL },
        });
      });

      await loadStart(webView, TRUSTED_URL);
      mockStopLoading.mockClear();

      await act(async () => {
        resolveStaleCheck({ result: false, name: '' });
        await staleLoad;
      });

      expect(mockStopLoading).not.toHaveBeenCalled();
      expect(mockBridges).toHaveLength(1);
      expect(mockBridges[0].url).toBe('https://trusted.example');
    });
  });
});
