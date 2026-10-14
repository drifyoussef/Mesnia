import { ModalController } from '@ionic/angular/standalone';
import { DocumentCategory, HouseholdDocument } from '../../models/document.model';
import { HouseholdMember } from '../../models/user.model';
import { DocumentFormModalComponent } from './document-form-modal.component';
import { DocumentViewerModalComponent } from './document-viewer-modal.component';

interface DocumentModalContext {
  members: HouseholdMember[];
  currentUserId: string | null;
}

/** Opens the "new document" sheet; resolves with the saved document, or null if cancelled. */
export async function openDocumentForm(
  modalController: ModalController,
  context: DocumentModalContext & { initialCategory?: DocumentCategory }
): Promise<HouseholdDocument | null> {
  const modal = await modalController.create({
    component: DocumentFormModalComponent,
    componentProps: context,
    breakpoints: [0, 1],
    initialBreakpoint: 1,
    cssClass: 'auto-sheet'
  });
  await modal.present();
  const { data } = await modal.onDidDismiss();
  return data?.document || null;
}

/** Opens a document; resolves with true when it was edited or deleted meanwhile. */
export async function openDocumentViewer(
  modalController: ModalController,
  document: HouseholdDocument,
  context: DocumentModalContext
): Promise<boolean> {
  const modal = await modalController.create({
    component: DocumentViewerModalComponent,
    componentProps: { document, ...context }
  });
  await modal.present();
  const { data } = await modal.onDidDismiss();
  return Boolean(data?.changed);
}
