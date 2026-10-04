import React from 'react';
import { TagPeoplePicker } from '../components/TagPeoplePicker';

/**
 * "Tag people" for one of your existing posts, from its ··· menu. A
 * transparent screen for the same reason as AddToCollection: two Modals
 * handing off on iOS can drop the second one.
 */
export function TagPeopleScreen({ navigation, route }: any) {
  return <TagPeoplePicker postId={route.params.postId} onClose={() => navigation.goBack()} />;
}
