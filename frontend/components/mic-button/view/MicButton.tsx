import { useMicButtonController } from '../hooks/useMicButtonController';
import MicButtonView from './MicButtonView';

type MicButtonProps = {
  onTranscript?: (transcript: string) => void;
  className?: string;
};

export default function MicButton({
  onTranscript,
  className = '',
}: MicButtonProps) {
  const { state, error, isSupported, handleButtonClick } = useMicButtonController({
    onTranscript,
  });

  return (
    <MicButtonView
      state={state}
      error={error}
      isSupported={isSupported}
      className={className}
      onButtonClick={handleButtonClick}
    />
  );
}
