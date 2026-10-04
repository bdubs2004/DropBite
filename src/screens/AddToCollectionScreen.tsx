import React from 'react';
import { CollectionPicker } from '../components/CollectionPicker';

/**
 * The "Add to collection" sheet for an existing post, opened from the post's
 * ··· menu. A transparent screen rather than a Modal inside the card, so it
 * opens cleanly right after the menu closes (two Modals handing off on iOS can
 * drop the second one).
 */
export function AddToCollectionScreen({ navigation, route }: any) {
  return <CollectionPicker postId={route.params.postId} onClose={() => navigation.goBack()} />;
}
