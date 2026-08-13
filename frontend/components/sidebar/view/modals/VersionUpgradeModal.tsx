/**
 * 文件目的：展示与安装方式匹配的手动升级指令。
 * 业务意义：Web UI 只允许复制命令，不向后端发起安装或自更新请求。
 */
import { useTranslation } from "react-i18next";
import { copyTextToClipboard } from "../../../../utils/clipboard";
import type { InstallMode } from "../../../../hooks/useVersionCheck";

interface VersionUpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentVersion: string;
    installMode: InstallMode;
}

/**
 * Render copy-only upgrade guidance for the detected installation method.
 */
export default function VersionUpgradeModal({
    isOpen,
    onClose,
    currentVersion,
    installMode
}: VersionUpgradeModalProps) {
    const { t } = useTranslation('common');
    const upgradeCommand = installMode === 'npm'
        ? t('versionUpdate.npmUpgradeCommand')
        : t('versionUpdate.gitUpgradeCommand');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <button
                className="fixed inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-label={t('versionUpdate.ariaLabels.closeModal')}
            />

            {/* Modal */}
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('versionUpdate.title')}</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {t('versionUpdate.manualUpgrade')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Version Info */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('versionUpdate.currentVersion')}</span>
                        <span className="text-sm text-gray-900 dark:text-white font-mono">{currentVersion}</span>
                    </div>
                </div>

                {/* Upgrade Instructions */}
                <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">{t('versionUpdate.manualUpgrade')}</h3>
                    <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 border">
                        <code className="text-sm text-gray-800 dark:text-gray-200 font-mono">
                            {upgradeCommand}
                        </code>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                        {t('versionUpdate.manualUpgradeHint')}
                    </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                    >
                        {t('versionUpdate.buttons.later')}
                    </button>
                    <button
                        onClick={() => copyTextToClipboard(upgradeCommand)}
                        className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                    >
                        {t('versionUpdate.buttons.copyCommand')}
                    </button>
                </div>
            </div>
        </div>
    );
}
