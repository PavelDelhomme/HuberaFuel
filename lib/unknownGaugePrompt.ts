/** Confirmation « Je ne sais pas » — niveau inconnu, sans plein forcé. */
import { Alert } from 'react-native';
import { unknownGaugeChoice, type UnknownGaugeChoice } from '@/lib/fuelLevelCore';

export function promptUnknownGauge(onYes: (choice: UnknownGaugeChoice) => void): void {
  Alert.alert(
    'Niveau inconnu',
    'À utiliser quand vous récupérez la voiture ou que vous la reprenez plusieurs jours après. « Je ne sais pas » ne force pas un plein. La consommation des trajets continue d’être estimée. L’état reste visible, distinct d’une jauge confirmée.',
    [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Je ne sais pas',
        onPress: () => onYes(unknownGaugeChoice()),
      },
    ]
  );
}
