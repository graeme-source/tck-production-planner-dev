import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateIngredient,
  useUpdateIngredient,
  useDeleteIngredient,
  getListIngredientsQueryKey,
  useCreateRecipe,
  useUpdateRecipe,
  useDeleteRecipe,
  getListRecipesQueryKey,
  useCreateSubRecipe,
  useUpdateSubRecipe,
  useDeleteSubRecipe,
  getListSubRecipesQueryKey,
  useCreateProductionPlan,
  useUpdateProductionPlan,
  useDeleteProductionPlan,
  getListProductionPlansQueryKey,
  useCreateStockEntry,
  useUpdateStockEntry,
  useDeleteStockEntry,
  getListStockEntriesQueryKey,
  useCreateSalesEntry,
  useUpdateSalesEntry,
  useDeleteSalesEntry,
  getListSalesEntriesQueryKey,
  useCreateDispatchOrder,
  useUpdateDispatchOrder,
  useDeleteDispatchOrder,
  getListDispatchOrdersQueryKey,
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  getListSuppliersQueryKey,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";

export function useAppMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSuccess = (queryKey: any[], message: string) => {
    queryClient.invalidateQueries({ queryKey });
    toast({ title: "Success", description: message });
  };

  const handleError = (error: any) => {
    toast({ title: "Error", description: error.message || "An error occurred", variant: "destructive" });
  };

  return {
    // Users
    createUser: useCreateUser({ mutation: { onSuccess: () => handleSuccess(getListUsersQueryKey(), "User created"), onError: handleError } }),
    updateUser: useUpdateUser({ mutation: { onSuccess: () => handleSuccess(getListUsersQueryKey(), "User updated"), onError: handleError } }),
    deleteUser: useDeleteUser({ mutation: { onSuccess: () => handleSuccess(getListUsersQueryKey(), "User deleted"), onError: handleError } }),

    // Suppliers
    createSupplier: useCreateSupplier({ mutation: { onSuccess: () => handleSuccess(getListSuppliersQueryKey(), "Supplier created"), onError: handleError } }),
    updateSupplier: useUpdateSupplier({ mutation: { onSuccess: () => handleSuccess(getListSuppliersQueryKey(), "Supplier updated"), onError: handleError } }),
    deleteSupplier: useDeleteSupplier({ mutation: { onSuccess: () => handleSuccess(getListSuppliersQueryKey(), "Supplier deleted"), onError: handleError } }),

    // Ingredients
    createIngredient: useCreateIngredient({ mutation: { onSuccess: () => handleSuccess(getListIngredientsQueryKey(), "Ingredient created"), onError: handleError } }),
    updateIngredient: useUpdateIngredient({ mutation: { onSuccess: () => handleSuccess(getListIngredientsQueryKey(), "Ingredient updated"), onError: handleError } }),
    deleteIngredient: useDeleteIngredient({ mutation: { onSuccess: () => handleSuccess(getListIngredientsQueryKey(), "Ingredient deleted"), onError: handleError } }),

    // SubRecipes
    createSubRecipe: useCreateSubRecipe({ mutation: { onSuccess: () => handleSuccess(getListSubRecipesQueryKey(), "Sub-recipe created"), onError: handleError } }),
    updateSubRecipe: useUpdateSubRecipe({ mutation: { onSuccess: () => handleSuccess(getListSubRecipesQueryKey(), "Sub-recipe updated"), onError: handleError } }),
    deleteSubRecipe: useDeleteSubRecipe({ mutation: { onSuccess: () => handleSuccess(getListSubRecipesQueryKey(), "Sub-recipe deleted"), onError: handleError } }),

    // Recipes
    createRecipe: useCreateRecipe({ mutation: { onSuccess: () => handleSuccess(getListRecipesQueryKey(), "Recipe created"), onError: handleError } }),
    updateRecipe: useUpdateRecipe({ mutation: { onSuccess: () => handleSuccess(getListRecipesQueryKey(), "Recipe updated"), onError: handleError } }),
    deleteRecipe: useDeleteRecipe({ mutation: { onSuccess: () => handleSuccess(getListRecipesQueryKey(), "Recipe deleted"), onError: handleError } }),

    // Production Plans
    createPlan: useCreateProductionPlan({ mutation: { onSuccess: () => handleSuccess(getListProductionPlansQueryKey(), "Plan created"), onError: handleError } }),
    updatePlan: useUpdateProductionPlan({ mutation: { onSuccess: () => handleSuccess(getListProductionPlansQueryKey(), "Plan updated"), onError: handleError } }),
    deletePlan: useDeleteProductionPlan({ mutation: { onSuccess: () => handleSuccess(getListProductionPlansQueryKey(), "Plan deleted"), onError: handleError } }),

    // Stock
    createStock: useCreateStockEntry({ mutation: { onSuccess: () => handleSuccess(getListStockEntriesQueryKey(), "Stock entry logged"), onError: handleError } }),
    updateStock: useUpdateStockEntry({ mutation: { onSuccess: () => handleSuccess(getListStockEntriesQueryKey(), "Stock updated"), onError: handleError } }),
    deleteStock: useDeleteStockEntry({ mutation: { onSuccess: () => handleSuccess(getListStockEntriesQueryKey(), "Stock deleted"), onError: handleError } }),

    // Sales
    createSale: useCreateSalesEntry({ mutation: { onSuccess: () => handleSuccess(getListSalesEntriesQueryKey(), "Sale logged"), onError: handleError } }),
    updateSale: useUpdateSalesEntry({ mutation: { onSuccess: () => handleSuccess(getListSalesEntriesQueryKey(), "Sale updated"), onError: handleError } }),
    deleteSale: useDeleteSalesEntry({ mutation: { onSuccess: () => handleSuccess(getListSalesEntriesQueryKey(), "Sale deleted"), onError: handleError } }),

    // Dispatches
    createDispatch: useCreateDispatchOrder({ mutation: { onSuccess: () => handleSuccess(getListDispatchOrdersQueryKey(), "Dispatch scheduled"), onError: handleError } }),
    updateDispatch: useUpdateDispatchOrder({ mutation: { onSuccess: () => handleSuccess(getListDispatchOrdersQueryKey(), "Dispatch updated"), onError: handleError } }),
    deleteDispatch: useDeleteDispatchOrder({ mutation: { onSuccess: () => handleSuccess(getListDispatchOrdersQueryKey(), "Dispatch deleted"), onError: handleError } }),
  };
}
